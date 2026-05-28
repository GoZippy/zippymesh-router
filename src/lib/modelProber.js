/**
 * Model Prober — active health probing for local and remote providers.
 *
 * Runs on a 5-minute schedule. Two probe types:
 *
 *  Recovery probes — degraded models whose backoff window has opened.
 *    A recovery probe either clears degraded state (success) or
 *    escalates the backoff tier (failure).
 *
 *  Health probes — active models probed periodically to measure TTFT.
 *    Skipped if the model already had a successful request in the probe
 *    interval (no point re-probing hot models that are clearly working).
 *
 * TTFT classification:
 *    cold = model hasn't been used in > COLD_THRESHOLD_MS  (5 min)
 *    hot  = model was used within COLD_THRESHOLD_MS
 *
 * Results are written back to modelHealth.js (recordModelSuccess /
 * recordModelFailure) so the degradation tracker stays accurate.
 */

import { getProviderConnections, getProviderNodes } from './localDb.js';
import { recordModelFailure, recordModelSuccess, getDegradedModels } from './modelHealth.js';

const PROBE_INTERVAL_MS   = 5  * 60 * 1000;   // 5 min
const COLD_THRESHOLD_MS   = 5  * 60 * 1000;   // how long since last use = cold
const HEALTH_PROBE_EVERY  = 30 * 60 * 1000;   // probe healthy models every 30 min
const PROBE_TIMEOUT_MS    = 15 * 1000;         // per-probe network timeout
const PROBE_MAX_TOKENS    = 1;                 // minimal response

// In-memory: { "provider/modelId" → lastUsedAt (timestamp) }
const lastUsedAt = new Map();

// In-memory: { "provider/modelId" → lastHealthProbeAt (timestamp) }
const lastHealthProbe = new Map();

let intervalHandle = null;

/**
 * Record that a model was used successfully (called from orchestrator or externally).
 * Used to classify cold vs hot TTFT.
 */
export function markModelUsed(provider, modelId) {
  lastUsedAt.set(`${provider}/${modelId}`, Date.now());
}

/**
 * Returns true if the model was last used within COLD_THRESHOLD_MS.
 */
function isHot(provider, modelId) {
  const t = lastUsedAt.get(`${provider}/${modelId}`);
  return t !== undefined && Date.now() - t < COLD_THRESHOLD_MS;
}

/**
 * Send a minimal completion probe to an OpenAI-compatible endpoint.
 * Returns { success, ttftMs, error }.
 */
async function probeOpenAI(baseUrl, apiKey, modelId) {
  const url = baseUrl.replace(/\/$/, '') + '/v1/chat/completions';
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey || 'none'}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: PROBE_MAX_TOKENS,
        stream: false,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    const ttftMs = Date.now() - start;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { success: false, ttftMs, error: `HTTP ${res.status}: ${text.slice(0, 120)}` };
    }

    return { success: true, ttftMs };
  } catch (err) {
    return { success: false, ttftMs: Date.now() - start, error: err.message };
  }
}

/**
 * Send a minimal probe to an Ollama endpoint.
 * Returns { success, ttftMs, error }.
 */
async function probeOllama(baseUrl, modelId) {
  // Ollama: check if model is listed first (fast), then do a short chat
  const url = baseUrl.replace(/\/$/, '') + '/api/chat';
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { num_predict: PROBE_MAX_TOKENS },
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    const ttftMs = Date.now() - start;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { success: false, ttftMs, error: `HTTP ${res.status}: ${text.slice(0, 120)}` };
    }

    return { success: true, ttftMs };
  } catch (err) {
    return { success: false, ttftMs: Date.now() - start, error: err.message };
  }
}

/**
 * Fetch the list of models from a local node.
 * Returns an array of model ID strings.
 */
async function fetchNodeModels(node) {
  try {
    if (node.apiType === 'ollama') {
      const res = await fetch(`${node.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || []).map((m) => m.name || m.model).filter(Boolean);
    } else {
      const baseUrl = node.baseUrl.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: 'Bearer lmstudio' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map((m) => m.id).filter(Boolean);
    }
  } catch {
    return [];
  }
}

/**
 * Probe a single (node, modelId) pair.
 * Records result into modelHealth.
 * Returns { provider, modelId, ttftMs, success, cold }.
 */
async function probeModel(node, modelId) {
  const provider = node.name || node.id;
  const cold = !isHot(provider, modelId);

  let result;
  if (node.apiType === 'ollama') {
    result = await probeOllama(node.baseUrl, modelId);
  } else {
    result = await probeOpenAI(node.baseUrl, node.apiKey || 'lmstudio', modelId);
  }

  if (result.success) {
    recordModelSuccess(provider, modelId);
    markModelUsed(provider, modelId);
    console.info(
      `[modelProber] ${provider}/${modelId} OK — ${cold ? 'cold' : 'hot'} TTFT ${result.ttftMs}ms`
    );
  } else {
    recordModelFailure(provider, modelId, 'probe_fail');
    console.warn(
      `[modelProber] ${provider}/${modelId} FAIL — ${result.error}`
    );
  }

  lastHealthProbe.set(`${provider}/${modelId}`, Date.now());

  return {
    provider,
    modelId,
    ttftMs: result.ttftMs,
    success: result.success,
    cold,
    error: result.error,
  };
}

/**
 * Run one probe cycle.
 * 1. Recovery probes for degraded models with open windows.
 * 2. Health probes for active local models not recently probed.
 */
async function runProbes() {
  const now = Date.now();

  // --- Recovery probes ---
  const degraded = getDegradedModels().filter((m) => m.probeWindowOpen);
  if (degraded.length > 0) {
    console.info(`[modelProber] Recovery probing ${degraded.length} degraded model(s)`);
  }

  const nodes = await getProviderNodes({ type: 'local' }).catch(() => []);

  for (const m of degraded) {
    const node = nodes.find(
      (n) =>
        n.name === m.provider ||
        n.id === m.provider ||
        (n.apiType === 'ollama' ? 'ollama' : 'lmstudio') === m.provider
    );
    if (node) {
      await probeModel(node, m.modelId).catch((e) =>
        console.error(`[modelProber] Recovery probe error: ${e.message}`)
      );
    }
  }

  // --- Health probes for local nodes ---
  for (const node of nodes) {
    const provider = node.name || node.id;
    const models = await fetchNodeModels(node);

    for (const modelId of models) {
      const key = `${provider}/${modelId}`;
      const lastProbe = lastHealthProbe.get(key) || 0;
      if (now - lastProbe < HEALTH_PROBE_EVERY) continue; // recently probed
      if (lastUsedAt.get(key) && now - lastUsedAt.get(key) < HEALTH_PROBE_EVERY) {
        // Model was used recently — mark success timestamp and skip probe
        lastHealthProbe.set(key, now);
        continue;
      }

      // Stagger probes slightly so we don't hammer all models at once
      await new Promise((r) => setTimeout(r, 200));
      await probeModel(node, modelId).catch((e) =>
        console.error(`[modelProber] Health probe error: ${e.message}`)
      );
    }
  }
}

/**
 * Start the background prober on a 5-minute interval.
 * Safe to call multiple times — only one interval is created.
 */
export function startModelProber() {
  if (intervalHandle) return;

  console.info('[modelProber] Starting — probe interval 5 min');

  // Run first probe after a short warm-up delay (30s) so the server
  // finishes initializing providers before we start hitting them.
  setTimeout(() => {
    runProbes().catch((e) => console.error('[modelProber] First run error:', e.message));
  }, 30_000);

  intervalHandle = setInterval(() => {
    runProbes().catch((e) => console.error('[modelProber] Probe error:', e.message));
  }, PROBE_INTERVAL_MS);
}

/**
 * Stop the prober (for clean shutdown / testing).
 */
export function stopModelProber() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export default { startModelProber, stopModelProber, markModelUsed };
