// OPEN_CORE_STUB — this file is a community-edition stub
// Community Edition Stub — upgrade to Pro for full functionality
const PRO_ERROR = { error: "This feature requires ZippyMesh Pro", code: "FEATURE_PRO" };

export async function zippyRpc(method, params = []) { return PRO_ERROR; }
export async function getZippyBalance(address) { return PRO_ERROR; }
export async function getZippyChainId() { return PRO_ERROR; }
export async function getZippyBlockNumber() { return PRO_ERROR; }
export async function getZippyTrustScore(address) { return PRO_ERROR; }
export async function getZippyEnvironmentalData() { return PRO_ERROR; }

// Added 2026-09-06 to restore export parity with src/lib/zippycoin-wallet.js.
// Without these the community build failed to compile:
// src/app/api/mesh/infer/route.js imports sendInferencePayment.
export async function getZippyBlockHeight() { return PRO_ERROR; }

// Deliberately throws rather than returning PRO_ERROR like the read helpers
// above. Its only caller (api/mesh/infer) wraps it in try/catch and records
// settlement.status = 'submitted' on any non-throwing return — a returned
// error object would make the response claim an on-chain payment that never
// happened. Throwing lands it in the 'error' branch, which is the truth.
export async function sendInferencePayment(_from, _to, _tokenCount) {
    throw new Error("on-chain settlement requires ZippyMesh Pro");
}
