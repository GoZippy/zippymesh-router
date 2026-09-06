/**
 * Optional: route the vault_* tools at a RUNNING ZMLR server instead of this
 * process's own vault library.
 *
 * Why this exists — the unlock-scope problem. `src/lib/vault.js` keeps the
 * master password in a module-level variable for the life of the process. The
 * stdio MCP server is a SEPARATE process from the ZMLR web server, so
 * unlocking the vault in the ZMLR UI does nothing for it: its `vault_get`
 * answers "Vault is locked" forever, and there is no stdio message that could
 * unlock it (the client would have to send the master password down the
 * transport, which we will not do).
 *
 * The fix, opt-in with one env var: set `ZMLR_URL=http://127.0.0.1:20128` and
 * the vault tools call the running server's frozen token routes
 * (`POST /api/vault/{read,list}-with-token`, contracts in the Kiro Crew
 * handoff §3) with `ZIPPYVAULT_TOKEN`. The unlock then lives where the user
 * actually performs it, and every read still lands in `vault_token_usage`.
 *
 * Unset `ZMLR_URL` and nothing here runs — tools use the local library, which
 * is right for a standalone stdio process that owns its own data dir.
 *
 * Not proxied: `vault_store` — there is no `store-with-token` route, and the
 * two token-route contracts are frozen. It stays on the local library.
 */

/**
 * Deliberately NOT imported from `../zmlr-server.js`: that module pulls in the
 * whole application graph, and this file is imported by `server.mjs` before
 * `protectStdout()` has run. Kept in lockstep by `tests/unit/mcpStdio.test.js`,
 * which asserts it still equals `VAULT_TOKEN_ENV` there.
 */
const VAULT_TOKEN_ENV = "ZIPPYVAULT_TOKEN";

/** Tools this proxy can serve from the HTTP routes that exist today. */
const PROXIED_TOOLS = new Set(["vault_status", "vault_list", "vault_get"]);

/** Request timeout for a call to the local ZMLR server. */
const TIMEOUT_MS = 15_000;

/** Loopback hosts the token may be sent to over plain http without an opt-in. */
function isLoopbackHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(h); // 127.0.0.0/8
}

/**
 * Build a proxy from the environment, or null when `ZMLR_URL` is not set.
 *
 * The agent token is POSTed in the request BODY to whatever host `ZMLR_URL`
 * names, so an unrestricted value is a one-env-var token exfiltration (H-12).
 * A non-loopback host is refused unless `ZMLR_ALLOW_REMOTE=1` is set AND the
 * URL is https — the token is never sent in cleartext to a remote host.
 *
 * @param {Record<string,string|undefined>} env
 */
export function makeVaultProxy(env = process.env) {
  const raw = (env.ZMLR_URL || "").trim();
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ZMLR_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`ZMLR_URL must be http(s), got '${url.protocol}//...' (${raw}).`);
  }
  if (!isLoopbackHost(url.hostname)) {
    if (env.ZMLR_ALLOW_REMOTE !== "1") {
      throw new Error(
        `Refusing to send the ZippyVault token to non-loopback host '${url.hostname}'. ` +
          "Set ZMLR_ALLOW_REMOTE=1 and use an https:// ZMLR_URL to target a remote ZMLR — " +
          "the token is POSTed in the request body, so cleartext http to a remote host would " +
          "expose it.",
      );
    }
    if (url.protocol !== "https:") {
      throw new Error(
        `Refusing to send the ZippyVault token in cleartext to remote host '${url.hostname}'. ` +
          "ZMLR_ALLOW_REMOTE=1 permits a remote host, but only over https://.",
      );
    }
  }

  return createVaultProxy(url.origin, () => env[VAULT_TOKEN_ENV] || null);
}

/**
 * @param {string} baseUrl — origin of a running ZMLR server
 * @param {() => string|null} getToken — reads the agent token at call time
 * @param {typeof fetch} [fetchImpl] — test seam
 */
export function createVaultProxy(baseUrl, getToken, fetchImpl = fetch) {
  async function post(path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Do not follow a redirect off the validated (loopback-unless-opted-in)
      // host — it would carry the vault token elsewhere (2026-08-30 verify V-3).
      redirect: "manual",
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body: fall through to the status-based error below */
    }
    return { status: res.status, json };
  }

  /** Map a token-route failure onto the `{ success:false, ... }` tool shape. */
  function failure(status, json) {
    const error = json?.error || `ZMLR server returned HTTP ${status}`;
    // 401 covers both a bad token and a locked vault; the route distinguishes
    // them only by message, and "Vault is locked" is the frozen text the Kiro
    // Crew bridge already keys on (handoff §3).
    const locked = status === 401 && /vault is locked/i.test(error);
    return {
      success: false,
      error,
      ...(locked ? { requires_unlock: true } : {}),
      ...(status === 401 && !locked ? { requires_token: true } : {}),
      via: baseUrl,
    };
  }

  const missingToken = {
    success: false,
    error:
      `ZippyVault agent token required: set ${VAULT_TOKEN_ENV} in the MCP server's ` +
      "environment. Issue one with POST /api/vault/tokens.",
    requires_token: true,
  };

  async function call(name, input) {
    const token = getToken();

    try {
      if (name === "vault_status") {
        // No dedicated status route; `list-with-token` reports `unlocked`.
        if (!token) return missingToken;
        const { status, json } = await post("/api/vault/list-with-token", { token });
        if (!json?.ok) return failure(status, json);
        return {
          success: true,
          unlocked: json.unlocked,
          entryCount: json.entries?.length ?? 0,
          scope: "token",   // in-scope entries, not the whole vault
          via: baseUrl,
        };
      }

      if (name === "vault_list") {
        if (!token) return missingToken;
        const { status, json } = await post("/api/vault/list-with-token", { token });
        if (!json?.ok) return failure(status, json);
        let entries = json.entries || [];
        if (input?.category) entries = entries.filter((e) => e.category === input.category);
        return {
          success: true,
          unlocked: json.unlocked,
          scopes: json.scopes,
          count: entries.length,
          entries: entries.map((e) => ({
            name: e.name,
            label: e.label,
            category: e.category,
            tags: e.tags || [],
            updated_at: e.updated_at,
          })),
          via: baseUrl,
        };
      }

      if (name === "vault_get") {
        if (!input?.name || typeof input.name !== "string") {
          return { success: false, error: "name is required" };
        }
        if (!token) return missingToken;
        const { status, json } = await post("/api/vault/read-with-token", {
          token,
          entry: input.name,
        });
        if (!json?.ok) return failure(status, json);
        return {
          success: true,
          name: json.name,
          label: json.label,
          category: json.category,
          value: json.value,
        };
      }

      return { success: false, error: `vault proxy does not handle '${name}'` };
    } catch (err) {
      const reason = err?.name === "TimeoutError"
        ? `no response within ${TIMEOUT_MS} ms`
        : err?.message ?? String(err);
      return {
        success: false,
        error: `Could not reach the ZMLR server at ${baseUrl}: ${reason}. ` +
          "Start ZMLR (npm start) or unset ZMLR_URL to use the local vault library.",
        via: baseUrl,
      };
    }
  }

  return {
    baseUrl,
    handles: (name) => PROXIED_TOOLS.has(name),
    call,
  };
}
