/**
 * Host classification for the local-runtime registration gate.
 *
 * Why this file exists (2026-08-30, adversarial round).
 *
 * `POST /api/provider-nodes {type:"local"}` takes a caller-supplied `baseUrl`,
 * fetches it, and mints a routing target from whatever answers. Before this
 * module there was no allow-list, deny-list, IP-literal check or link-local
 * filter anywhere on that path (finding H1), and the only "is this local?"
 * helper in the tree was a substring test:
 *
 *     baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")
 *
 * which classifies `http://127.0.0.1.evil.com/` and `http://localhost.evil.com/`
 * as loopback (finding M9). That helper only picked a probe timeout, but it is
 * exactly the one anyone fixing H1 would reach for as a trust boundary — so the
 * trust boundary lives here instead, parses with `new URL()`, and compares
 * `url.hostname` against real address ranges.
 *
 * ## The policy
 *
 * | class        | what it is                                   | may register?          |
 * |--------------|----------------------------------------------|------------------------|
 * | `loopback`   | 127.0.0.0/8, ::1, `localhost`, 0.0.0.0, ::   | yes                    |
 * | `private`    | RFC1918 10/8 172.16/12 192.168/16, fc00::/7  | yes                    |
 * | `mdns`       | a `.local` / `.localhost` name               | yes                    |
 * | `link-local` | 169.254.0.0/16, fe80::/10                    | only with `allowRemote`|
 * | `unresolved` | a name DNS could not answer for              | only with `allowRemote`|
 * | `public`     | anything else, incl. a name resolving public | **never**              |
 *
 * `link-local` is NOT in the default-allowed set even though it is nominally a
 * LAN range: 169.254.169.254 is the cloud instance-metadata service and no LLM
 * runtime has ever lived there. The review's H1 names it explicitly as an SSRF
 * target. An operator who really means it can still pass `allowRemote:true`
 * from an admin session.
 *
 * ## What this does NOT protect against
 *
 * DNS rebinding. A name is resolved here and resolved again by `fetch()`; a
 * hostile resolver can answer differently the second time. Node's fetch gives
 * no supported way to pin the address that was vetted. Loopback and IP-literal
 * targets — the whole install story — are unaffected, because a literal is
 * never resolved at all.
 */

/** Host spellings that all mean "this machine". Mirrors localDiscovery.js. */
const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "::"]);

/** Classes a caller may register without opting in. */
export const DEFAULT_ALLOWED_CLASSES = new Set(["loopback", "private", "mdns"]);

/** Classes an admin may register with an explicit `allowRemote:true`. */
export const OPT_IN_CLASSES = new Set(["link-local", "unresolved"]);

/** Strip IPv6 brackets and lowercase. Returns "" for a non-string. */
export function normalizeHostname(hostname) {
  if (typeof hostname !== "string") return "";
  let h = hostname.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h;
}

/** @returns {number[]|null} the four octets, or null when this is not an IPv4 literal. */
function parseIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

function classifyIPv4([a, b]) {
  if (a === 127) return "loopback";
  if (a === 0) return "loopback";                              // 0.0.0.0 — "this host"
  if (a === 169 && b === 254) return "link-local";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  return "public";
}

/** Very small IPv6 classifier: only the ranges the policy above distinguishes. */
function classifyIPv6(host) {
  if (host === "::1" || host === "::") return "loopback";
  if (/^fe[89ab]/.test(host)) return "link-local";             // fe80::/10
  if (/^f[cd]/.test(host)) return "private";                   // fc00::/7 ULA
  return "public";
}

function looksLikeIPv6(host) {
  return host.includes(":");
}

/**
 * Classify a hostname WITHOUT touching DNS.
 *
 * @param {string} hostname
 * @returns {"loopback"|"private"|"link-local"|"mdns"|"public"|"name"} — `"name"`
 *   means "not a literal and not an obviously-local name"; the caller must
 *   resolve it (see classifyHost) before trusting anything.
 */
export function classifyHostnameSync(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return "public";
  if (LOOPBACK_NAMES.has(host)) return "loopback";
  const v4 = parseIPv4(host);
  if (v4) return classifyIPv4(v4);
  if (looksLikeIPv6(host)) return classifyIPv6(host);
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  if (host.endsWith(".local")) return "mdns";
  return "name";
}

/**
 * Classify a hostname, resolving it when it is not a literal.
 *
 * A name is only as safe as its *worst* address: if any A/AAAA record is
 * public, the whole name is `public`. A name that will not resolve is
 * `unresolved` — fail-closed, not fail-open.
 *
 * @param {string} hostname
 * @returns {Promise<"loopback"|"private"|"link-local"|"mdns"|"public"|"unresolved">}
 */
export async function classifyHost(hostname) {
  const sync = classifyHostnameSync(hostname);
  if (sync !== "name") return sync;

  let addresses;
  try {
    const { lookup } = await import("node:dns/promises");
    addresses = await lookup(normalizeHostname(hostname), { all: true, verbatim: true });
  } catch {
    return "unresolved";
  }
  if (!Array.isArray(addresses) || addresses.length === 0) return "unresolved";

  // Rank worst-first: one public address makes the whole name public.
  const RANK = { public: 0, unresolved: 1, "link-local": 2, private: 3, mdns: 4, loopback: 5 };
  let worst = "loopback";
  for (const a of addresses) {
    const k = classifyHostnameSync(a.address);
    const c = k === "name" ? "public" : k;
    if (RANK[c] < RANK[worst]) worst = c;
  }
  return worst;
}

/**
 * Is this URL a loopback URL? Parsed, not substring-matched (fix for M9).
 * @param {string} baseUrl
 */
export function isLoopbackUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl) return false;
  try {
    return classifyHostnameSync(new URL(baseUrl).hostname) === "loopback";
  } catch {
    return false;
  }
}

/**
 * The registration gate.
 *
 * @param {string} baseUrl              the URL the caller wants registered
 * @param {{allowRemote?: boolean, isAdmin?: boolean}} [opts]
 * @returns {Promise<{allowed: boolean, hostClass: string, hostname: string, reason: string|null}>}
 *   `reason` is a short, caller-safe string; it never carries anything read
 *   from the target.
 */
export async function checkRegistrationTarget(baseUrl, opts = {}) {
  let hostname;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return { allowed: false, hostClass: "invalid", hostname: "", reason: "baseUrl is not a parseable URL" };
  }

  const hostClass = await classifyHost(hostname);

  if (DEFAULT_ALLOWED_CLASSES.has(hostClass)) {
    return { allowed: true, hostClass, hostname, reason: null };
  }

  if (hostClass === "public") {
    return {
      allowed: false, hostClass, hostname,
      reason: `refusing to register a public address (${hostname}). A local runtime must be on loopback, an RFC1918 private network, or a .local name.`,
    };
  }

  if (OPT_IN_CLASSES.has(hostClass)) {
    if (opts.allowRemote === true && opts.isAdmin === true) {
      return { allowed: true, hostClass, hostname, reason: null };
    }
    const why = hostClass === "link-local"
      ? "link-local addresses (169.254.0.0/16, fe80::/10) host cloud instance metadata, not LLM runtimes"
      : "that hostname does not resolve";
    return {
      allowed: false, hostClass, hostname,
      reason: `refusing to register ${hostname}: ${why}. Pass "allowRemote": true from an admin session if you really mean it.`,
    };
  }

  return { allowed: false, hostClass, hostname, reason: `refusing to register ${hostname}` };
}
