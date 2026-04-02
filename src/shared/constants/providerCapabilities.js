/**
 * Provider capability registry for shared policy decisions across UI and API flows.
 */
const DEFAULT_OAUTH_CAPABILITIES = {
  flowType: "authorization_code",
  deviceCodeRequiresCodeVerifier: false,
  deviceCodeRequiresExtraData: false,
  requiresManualCallback: false,
};

const OAUTH_PROVIDER_CAPABILITIES = {
  codex: {
    flowType: "authorization_code_pkce",
    requiresManualCallback: true,
    manualCallbackPort: 1455,
  },
  "iflow": {
    flowType: "authorization_code",
  },
  "gemini-cli": {
    flowType: "authorization_code",
  },
  antigravity: {
    flowType: "authorization_code",
  },
  github: {
    flowType: "device_code",
    deviceCodeRequiresCodeVerifier: false,
    deviceCodeRequiresExtraData: false,
  },
  qwen: {
    flowType: "device_code",
    deviceCodeRequiresCodeVerifier: true,
    deviceCodeRequiresExtraData: false,
  },
  kiro: {
    flowType: "device_code",
    deviceCodeRequiresCodeVerifier: false,
    deviceCodeRequiresExtraData: true,
  },
};

function getRawCapability(providerId, fallbackFlowType = "authorization_code") {
  const capability = OAUTH_PROVIDER_CAPABILITIES[providerId] || {};
  return {
    ...DEFAULT_OAUTH_CAPABILITIES,
    ...capability,
    flowType: capability.flowType || fallbackFlowType,
  };
}

export function getOAuthProviderCapabilities(providerId) {
  return getRawCapability(providerId);
}

export function getOAuthFlowType(providerId) {
  return getRawCapability(providerId).flowType;
}

export function requiresDeviceCodePkce(providerId) {
  return Boolean(getRawCapability(providerId).deviceCodeRequiresCodeVerifier);
}

export function requiresDeviceCodeExtraData(providerId) {
  return Boolean(getRawCapability(providerId).deviceCodeRequiresExtraData);
}

export function requiresManualCallback(providerId) {
  return Boolean(getRawCapability(providerId).requiresManualCallback);
}

export function getManualCallbackPort(providerId) {
  const raw = getRawCapability(providerId);
  return raw.manualCallbackPort ? Number(raw.manualCallbackPort) : null;
}

export function isDeviceCodeProvider(providerId) {
  return getOAuthFlowType(providerId) === "device_code";
}
