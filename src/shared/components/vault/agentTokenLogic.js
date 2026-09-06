/**
 * Pure logic for the ZippyVault Agent Tokens panel.
 *
 * Kept free of React and of any DOM/browser API so it can be unit-tested in
 * the project's Node vitest environment (see tests/unit/agentTokensPanel.test.js).
 * This mirrors the existing convention of `meshSignatureConfig.js` sitting
 * beside `MeshSignatureBadge.js`.
 *
 * Nothing here ever holds a raw token outside the reveal state machine, and the
 * reveal state machine only holds one between `issue_success` and `done`.
 */

/** The wildcard scope understood by src/lib/vaultTokens.js. */
export const ALL_ENTRIES_SCOPE = "*";

/**
 * How `*` is rendered to a human. Writing through a token is reserved for `*`
 * (storeVaultEntryWithToken in src/lib/vaultTokens.js), so the label says so.
 */
export const ALL_ENTRIES_LABEL = "All entries (read + write)";

/** One-line reminder shown next to the scope picker. */
export const SCOPE_WRITE_NOTE =
  'Only a token scoped to "All entries" can write to the vault — tokens scoped to named entries are read-only.';

const MINUTE = 60 * 1000;
const HOUR   = 60 * MINUTE;
const DAY    = 24 * HOUR;

/**
 * Expiry choices offered in the issue modal. `ms === null` means "no expiry"
 * and MUST be sent as an absent `expiresInMs` — issueAgentToken() rejects a
 * non-positive or non-numeric TTL.
 */
export const EXPIRY_OPTIONS = Object.freeze([
  { value: "never", label: "Never",    ms: null },
  { value: "1h",    label: "1 hour",   ms: 1 * HOUR },
  { value: "24h",   label: "24 hours", ms: 24 * HOUR },
  { value: "7d",    label: "7 days",   ms: 7 * DAY },
  { value: "30d",   label: "30 days",  ms: 30 * DAY },
  { value: "90d",   label: "90 days",  ms: 90 * DAY },
]);

export const DEFAULT_EXPIRY = "30d";

/**
 * Map an expiry option value to milliseconds.
 * @returns {number|null} null for "never" or any unknown value (fail safe:
 *   an unknown value must never become an accidental TTL).
 */
export function expiryToMs(value) {
  const opt = EXPIRY_OPTIONS.find(o => o.value === value);
  return opt ? opt.ms : null;
}

/** Human label for one scope chip. */
export function formatScopeLabel(scope) {
  return scope === ALL_ENTRIES_SCOPE ? ALL_ENTRIES_LABEL : scope;
}

/**
 * Build the POST /api/vault/tokens body from the issue-modal form state.
 *
 * @param {object} form
 * @param {string} form.name             human label, required
 * @param {boolean} [form.allEntries]    the "All entries (*)" toggle
 * @param {string[]} [form.selectedNames] checked vault entry names
 * @param {string} [form.expiry]         an EXPIRY_OPTIONS value
 * @returns {{ok: true, payload: {name: string, scopes: string[], expiresInMs?: number}}
 *          |{ok: false, error: string}}
 */
export function buildIssuePayload(form = {}) {
  const { name, allEntries = false, selectedNames = [], expiry = DEFAULT_EXPIRY } = form;

  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    return { ok: false, error: "Give the token a name so you can recognise it later." };
  }

  let scopes;
  if (allEntries) {
    scopes = [ALL_ENTRIES_SCOPE];
  } else {
    scopes = Array.from(
      new Set(
        (Array.isArray(selectedNames) ? selectedNames : [])
          .filter(s => typeof s === "string" && s.trim().length > 0)
          .map(s => s.trim())
      )
    );
    if (scopes.length === 0) {
      return { ok: false, error: 'Select at least one vault entry, or turn on "All entries".' };
    }
    // "*" always wins: a scope list containing the wildcard grants everything,
    // so collapse it rather than sending a misleading mixed list.
    if (scopes.includes(ALL_ENTRIES_SCOPE)) scopes = [ALL_ENTRIES_SCOPE];
  }

  const payload = { name: trimmedName, scopes };
  const expiresInMs = expiryToMs(expiry);
  if (expiresInMs !== null) payload.expiresInMs = expiresInMs;
  return { ok: true, payload };
}

// ── Time formatting ───────────────────────────────────────────────────────────

/** Coarse, human duration for a positive millisecond span. */
export function humanizeMs(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < MINUTE) return "less than a minute";
  if (ms < HOUR) {
    const m = Math.floor(ms / MINUTE);
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.floor(ms / DAY);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/**
 * Expiry cell text.
 * @param {number|null|undefined} expiresAt epoch ms, or null for "no expiry"
 */
export function formatExpiry(expiresAt, now = Date.now()) {
  if (expiresAt === null || expiresAt === undefined) return "Never";
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return "Never";
  if (expiresAt <= now) return "Expired";
  return `in ${humanizeMs(expiresAt - now)}`;
}

/** True when a listed token is already past its expiry (server also enforces). */
export function isExpired(token, now = Date.now()) {
  const at = token?.expires_at;
  return typeof at === "number" && Number.isFinite(at) && at <= now;
}

/**
 * Last-used cell text.
 * @param {number|null|undefined} lastUsedAt epoch ms, or null when never used
 */
export function formatLastUsed(lastUsedAt, now = Date.now()) {
  if (lastUsedAt === null || lastUsedAt === undefined) return "Never";
  if (typeof lastUsedAt !== "number" || !Number.isFinite(lastUsedAt)) return "Never";
  const delta = now - lastUsedAt;
  if (delta < MINUTE) return "just now";
  return `${humanizeMs(delta)} ago`;
}

/** Absolute timestamp for the "Created" cell. */
export function formatTimestamp(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}

// ── One-time reveal state machine ─────────────────────────────────────────────
//
// The raw token exists in exactly one place — `state.token.rawToken` — and only
// while `state.status === "revealed"`. `done` drops it. It is never written to
// localStorage, the URL, or a log.

export const REVEAL_INITIAL = Object.freeze({ status: "idle", token: null, error: "" });

const NO_TOKEN_RETURNED =
  "The server did not return a token value. Check the list below and revoke any token you cannot use.";

/**
 * @param {{status: string, token: object|null, error: string}} state
 * @param {{type: string, token?: object, error?: string}} action
 */
export function revealReducer(state = REVEAL_INITIAL, action = {}) {
  switch (action.type) {
    case "issue_start":
      return { status: "issuing", token: null, error: "" };

    case "issue_success": {
      const raw = action.token?.rawToken;
      if (typeof raw !== "string" || raw.length === 0) {
        return { status: "error", token: null, error: NO_TOKEN_RETURNED };
      }
      return { status: "revealed", token: { ...action.token }, error: "" };
    }

    case "issue_error":
      return { status: "error", token: null, error: action.error || "Could not issue token" };

    case "done":
    case "reset":
      return { status: "idle", token: null, error: "" };

    default:
      return state;
  }
}

/**
 * The single accessor for the raw token. Returns null in every state except
 * "revealed", so a caller cannot read it before issue or after Done.
 */
export function revealedToken(state) {
  return state?.status === "revealed" ? (state.token?.rawToken ?? null) : null;
}

// ── Error envelopes ───────────────────────────────────────────────────────────

/**
 * ZMLR emits two error shapes on these routes:
 *   - the vault routes' own `{ error: "name is required" }` (a string), and
 *   - requireAuth()'s OpenAI-style `{ error: { message, type, code } }`
 *     (src/lib/apiErrors.js -> open-sse errorResponse) used for 401/429.
 * Pick a message out of either, falling back to safeFetchJson's own `error`.
 */
export function extractErrorMessage(result, fallback = "Request failed") {
  const data = result?.data;
  if (typeof data?.error === "string" && data.error.trim()) return data.error.trim();
  if (typeof data?.error?.message === "string" && data.error.message.trim()) {
    return data.error.message.trim();
  }
  if (typeof data?.message === "string" && data.message.trim()) return data.message.trim();
  if (typeof result?.error === "string" && result.error.trim()) return result.error.trim();
  return fallback;
}
