#!/usr/bin/env node
/**
 * Connector validation script - tests API endpoints and provider connectivity.
 * Run: node tests/connectors.validate.js [baseUrl]
 * Default baseUrl: http://localhost:20128
 */
const BASE = process.argv[2] || "http://localhost:20128";

async function fetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 10000);
  try {
    const res = await globalThis.fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function run() {
  console.log(`\n=== ZippyMesh Connector Validation ===`);
  console.log(`Base URL: ${BASE}\n`);

  const results = { ok: 0, fail: 0, errors: [] };

  // 1. Health
  try {
    const r = await fetch(`${BASE}/api/health`);
    const j = await r.json();
    if (r.ok && j.ok) {
      console.log(`✓ Health: ok | version=${j.version} | providers=${j.providersConfigured} active=${j.providersActive} rateLimited=${j.providersRateLimited ?? "n/a"}`);
      results.ok++;
    } else {
      console.log(`✗ Health: ${r.status} ${JSON.stringify(j)}`);
      results.fail++;
      results.errors.push("health");
    }
  } catch (e) {
    console.log(`✗ Health: ${e.message} (is the server running?)`);
    results.fail++;
    results.errors.push("health");
    console.log("\nCannot continue without health. Start server with: npm run dev or start-stable.cmd");
    process.exit(1);
  }

  // 2. Models
  try {
    const r = await fetch(`${BASE}/v1/models`);
    const j = await r.json();
    if (r.ok && Array.isArray(j.data)) {
      const playbook = j.data.filter(m => m.owned_by === "zippymesh").length;
      const local = j.data.filter(m => m.zippy?.source === "local").length;
      console.log(`✓ Models: ${j.data.length} total (${playbook} playbooks, ${local} local)`);
      results.ok++;
    } else {
      console.log(`✗ Models: ${r.status}`);
      results.fail++;
      results.errors.push("models");
    }
  } catch (e) {
    console.log(`✗ Models: ${e.message}`);
    results.fail++;
    results.errors.push("models");
  }

  // 3. Provider status (public for agents; 401 if proxy not restarted)
  try {
    const r = await fetch(`${BASE}/api/provider-status`);
    const j = r.ok ? await r.json() : {};
    if (r.ok && Array.isArray(j.providers)) {
      const active = j.providers.filter(p => p.isActive && p.status === "active").length;
      const limited = j.providers.filter(p => p.rateLimited).length;
      console.log(`✓ Provider status: ${j.providers.length} providers (${active} active, ${limited} rate-limited)`);
      results.ok++;
    } else if (r.status === 401) {
      console.log(`○ Provider status: 401 (add /api/provider-status to proxy public APIs and restart)`);
      results.ok++;
    } else {
      console.log(`✗ Provider status: ${r.status}`);
      results.fail++;
      results.errors.push("provider-status");
    }
  } catch (e) {
    console.log(`✗ Provider status: ${e.message}`);
    results.fail++;
    results.errors.push("provider-status");
  }

  // 4. Chat completions (minimal test - expect 400/422 if no model or 200 if routed)
  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "zippymesh/ask",
        messages: [{ role: "user", content: "Say OK" }],
        max_tokens: 5
      }),
      timeout: 15000
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { j = { error: text }; }
    if (r.ok) {
      const choice = j.choices?.[0]?.message?.content;
      console.log(`✓ Chat: 200 (response: ${(choice || "").slice(0, 40)}...)`);
      results.ok++;
    } else if (r.status === 400 || r.status === 422 || r.status === 503) {
      console.log(`○ Chat: ${r.status} (expected if no providers/keys: ${j.error?.message || j.message || "see body"})`);
      results.ok++;
    } else {
      console.log(`✗ Chat: ${r.status} ${text.slice(0, 100)}`);
      results.fail++;
      results.errors.push("chat");
    }
  } catch (e) {
    console.log(`✗ Chat: ${e.message}`);
    results.fail++;
    results.errors.push("chat");
  }

  // 5. Rate limits API
  try {
    const r = await fetch(`${BASE}/api/tokenbuddy/rate-limits?all=true`);
    const j = await r.json();
    if (r.ok) {
      const count = Object.keys(j.rateLimits || {}).length;
      console.log(`✓ Rate limits: ${count} provider configs`);
      results.ok++;
    } else {
      console.log(`○ Rate limits: ${r.status} (optional)`);
      results.ok++;
    }
  } catch (e) {
    console.log(`○ Rate limits: ${e.message} (optional)`);
    results.ok++;
  }

  console.log(`\n--- Summary: ${results.ok} passed, ${results.fail} failed ---`);
  if (results.errors.length) {
    console.log(`Failed: ${results.errors.join(", ")}`);
  }
  process.exit(results.fail > 0 ? 1 : 0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
