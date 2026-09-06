// OPEN_CORE_STUB — this file is a community-edition stub
// Community Edition Stub — upgrade to Pro for full functionality
// The real implementation sources peers from the sidecar's libp2p Gossipsub
// swarm (mDNS + bootstrap peers + Kademlia DHT); that sidecar integration is
// a Pro feature (see stubs/community/src/lib/sidecar.js).

export class GossipDiscoveryService {
  async syncOnce() { return []; }
  start() { return false; }
  stop() {}
}

export const gossipDiscovery = new GossipDiscoveryService();
export default gossipDiscovery;
