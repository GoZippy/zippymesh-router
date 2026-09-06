// OPEN_CORE_STUB — sidecar client (proprietary P2P mesh integration, not in community edition)

export function getSidecarUrl() { return null; }
export function sidecarUrl(_path) { return null; }
export function sidecarAuthHeaders() { return {}; }
export async function fetchSidecar(_path, _options) { return null; }
export async function fetchSidecarWithTimeout(_path, _timeoutMs, _options) { return null; }
export async function proxyChatCompletion(_payload) { return null; }
export async function getSidecarPeers() { return []; }
export async function getSidecarHealth() { return { ok: false, stub: true }; }
export async function getSidecarInfo() { return null; }
export async function getWalletBalance() { return null; }
export async function getWalletTransactions() { return []; }
export async function getWalletEarnings() { return null; }
export async function openPaymentChannel(_to, _amount) { return null; }

// ── Wallet surface ───────────────────────────────────────────────────────────
// Added 2026-09-06. The real src/lib/sidecar.js grew these four exports in
// d211222 (zippycoin-core chain 947 wiring) but this stub was not updated, so
// the community build failed to compile: src/app/api/v1/wallet/fund/route.js
// and .../wallet/send/route.js import names that did not exist here.
//
// The read path returns the same "nothing there" value the real function
// returns when the sidecar is unreachable. The write paths throw, because
// every caller wraps them in try/catch and surfaces the message — returning
// null instead would let a route answer { success: true } for a transfer that
// never happened.
const NO_SIDECAR = "sidecar is not available in the community edition";

export async function getSidecarWalletBalance() { throw new Error(NO_SIDECAR); }
export async function getSidecarWalletAddress() { return null; }
export async function walletSend(_to, _opts) { throw new Error(NO_SIDECAR); }
export async function devFundWallet(_to, _opts) { throw new Error(NO_SIDECAR); }
