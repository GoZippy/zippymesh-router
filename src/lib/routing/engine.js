// OPEN_CORE_STUB — routing engine (proprietary, not included in community edition)
// The full routing engine is part of ZippyMesh LLM Router Pro.
// Community edition uses basic round-robin routing without scoring or ML features.

export class RoutingEngine {
  constructor() {}
  async route(providers, _request) {
    if (!providers || providers.length === 0) return null;
    return providers[0];
  }
  async score(_provider, _request) { return 0.5; }
}
