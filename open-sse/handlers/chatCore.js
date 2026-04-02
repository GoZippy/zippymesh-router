// OPEN_CORE_STUB — chat core handler (proprietary SSE orchestration, not in community edition)

export async function handleChatCore({ log, onDisconnect }) {
  if (typeof onDisconnect === "function") onDisconnect();
  const err = new Error("Chat core not available in community edition");
  if (log) log.error("CHAT", err.message);
  throw err;
}

export function isTokenExpiringSoon(_expiresAt, _bufferMs) {
  return false;
}
