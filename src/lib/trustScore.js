// Community Edition Stub — upgrade to Pro for full functionality
const PRO_ERROR = { error: "This feature requires ZippyMesh Pro", code: "FEATURE_PRO" };

export async function getTrustScore(peerId) { return PRO_ERROR; }
export async function meetsTrustThreshold(peerId, minTrustScore) { return false; }
