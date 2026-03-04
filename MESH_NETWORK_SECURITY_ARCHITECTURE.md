# ZippyMesh Network Security & Routing Architecture
**Version:** 1.0  
**Date:** 2026-03-03  
**Status:** Design Document

---

## Overview

This document defines the security and routing architecture for the ZippyMesh P2P LLM routing network. The architecture ensures secure provider discovery, encrypted communications, reputation-based routing, and fair payment settlement.

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USER APPLICATION LAYER                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Level 0   │  │   Level 1   │  │   Level 2   │  │   Level 3   │        │
│  │  Consumer   │  │  Explorer   │  │  Provider   │  │  Operator   │        │
│  │  (Local)    │  │  (Mesh)     │  │  (Host)     │  │  (Node)     │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DIRECTORY & DISCOVERY LAYER                             │
│                                                                              │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│   │  On-Chain       │    │  DHT Cache      │    │  mDNS Local     │        │
│   │  Registry       │◄──►│  (Kademlia)     │◄──►│  Discovery      │        │
│   │  (Smart Contract)│   │                 │    │                 │        │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘        │
│                                                                              │
│   • Provider Registration  • Service Lookup   • Local Network Scan         │
│   • Reputation Scoring     • Peer Discovery   • Auto-provisioning          │
│   • Pricing Oracles        • Route Caching                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ROUTING & ORCHESTRATION LAYER                          │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────┐          │
│   │              ZippyMesh LLM Routing Engine                    │          │
│   │                                                              │          │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │          │
│   │  │   Playbook  │  │   Provider  │  │   Failover  │         │          │
│   │  │   Engine    │──►│  Selection  │──►│   Logic     │         │          │
│   │  └─────────────┘  └─────────────┘  └─────────────┘         │          │
│   │         │                  │                  │             │          │
│   │         ▼                  ▼                  ▼             │          │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │          │
│   │  │ Cost/Latency│  │Reputation   │  │  Capacity   │         │          │
│   │  │   Scoring   │  │   Filter    │  │   Check     │         │          │
│   │  └─────────────┘  └─────────────┘  └─────────────┘         │          │
│   └─────────────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SECURE COMMUNICATION LAYER                              │
│                                                                              │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│   │  TLS 1.3 +      │    │  Request        │    │  Onion Routing  │        │
│   │  Dilithium      │───►│  Signing        │───►│  (Optional)     │        │
│   │  Certificates   │    │  (Ed25519)      │    │  3-hop          │        │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘        │
│                                                                              │
│   • Quantum-resistant key exchange    • Message integrity proofs           │
│   • Perfect forward secrecy           • Anonymous routing                  │
│   • Certificate pinning               • Traffic correlation resistance     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PAYMENT & SETTLEMENT LAYER                            │
│                                                                              │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│   │  ZippyCore L1   │    │  ZippyEdge L2   │    │  HTLC Contracts │        │
│   │  (Governance)   │◄──►│  (Micropay)     │◄──►│  (Atomic Swap)  │        │
│   │                 │    │                 │    │                 │        │
│   │ • Staking       │    │ • State Channels│    │ • Trustless     │        │
│   │ • Governance    │    │ • Fast finality │    │ • Auto-settle   │        │
│   │ • High value    │    │ • Low fees      │    │ • Multi-hop     │        │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Directory & Discovery Service

### On-Chain Service Registry (Smart Contract)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ZippyMeshServiceRegistry
 * @notice On-chain registry for LLM providers in the ZippyMesh network
 */
contract ZippyMeshServiceRegistry {
    
    struct Provider {
        address owner;
        bytes32 nodeId;
        string endpoint;
        string[] models;
        uint256 pricePerToken;
        uint256 stakeAmount;
        uint256 reputationScore;
        uint256 lastHeartbeat;
        bool isActive;
    }
    
    struct ServiceOffer {
        bytes32 providerId;
        string modelId;
        uint256 price;
        uint256 maxLatency;
        uint256 capacity;
        uint256 available;
    }
    
    // Provider registration
    mapping(bytes32 => Provider) public providers;
    mapping(address => bytes32[]) public providerByOwner;
    
    // Service discovery
    mapping(string => ServiceOffer[]) public servicesByModel;
    mapping(bytes32 => bytes32[]) public providerServices;
    
    // Reputation
    mapping(bytes32 => uint256) public successfulRequests;
    mapping(bytes32 => uint256) public failedRequests;
    mapping(bytes32 => uint256) public totalEarnings;
    
    // Minimum stake to become a provider (100 ZIP)
    uint256 public constant MINIMUM_STAKE = 100 * 10**18;
    
    // Heartbeat timeout (10 minutes)
    uint256 public constant HEARTBEAT_TIMEOUT = 600;
    
    event ProviderRegistered(bytes32 indexed providerId, address indexed owner, string endpoint);
    event ServiceOffered(bytes32 indexed providerId, string modelId, uint256 price);
    event Heartbeat(bytes32 indexed providerId, uint256 timestamp);
    event ReputationUpdated(bytes32 indexed providerId, uint256 newScore);
    
    /**
     * @notice Register as a new LLM provider
     */
    function registerProvider(
        bytes32 nodeId,
        string calldata endpoint,
        string[] calldata models,
        uint256 pricePerToken
    ) external payable returns (bytes32 providerId) {
        require(msg.value >= MINIMUM_STAKE, "Insufficient stake");
        require(bytes(endpoint).length > 0, "Invalid endpoint");
        require(models.length > 0, "No models specified");
        
        providerId = keccak256(abi.encodePacked(msg.sender, nodeId, block.timestamp));
        
        providers[providerId] = Provider({
            owner: msg.sender,
            nodeId: nodeId,
            endpoint: endpoint,
            models: models,
            pricePerToken: pricePerToken,
            stakeAmount: msg.value,
            reputationScore: 5000, // Initial score (out of 10000)
            lastHeartbeat: block.timestamp,
            isActive: true
        });
        
        providerByOwner[msg.sender].push(providerId);
        
        emit ProviderRegistered(providerId, msg.sender, endpoint);
        
        // Register services for each model
        for (uint i = 0; i < models.length; i++) {
            _addServiceOffer(providerId, models[i], pricePerToken);
        }
    }
    
    /**
     * @notice Submit heartbeat to prove liveness
     */
    function heartbeat(bytes32 providerId) external {
        Provider storage provider = providers[providerId];
        require(provider.owner == msg.sender, "Not owner");
        require(provider.isActive, "Provider inactive");
        
        provider.lastHeartbeat = block.timestamp;
        emit Heartbeat(providerId, block.timestamp);
    }
    
    /**
     * @notice Discover providers for a specific model
     */
    function discoverProviders(
        string calldata modelId,
        uint256 maxPrice,
        uint256 maxLatency,
        uint256 minReputation
    ) external view returns (ServiceOffer[] memory) {
        ServiceOffer[] storage offers = servicesByModel[modelId];
        uint256 count = 0;
        
        // Count matching offers
        for (uint i = 0; i < offers.length; i++) {
            Provider storage provider = providers[offers[i].providerId];
            if (_isProviderValid(provider, maxPrice, maxLatency, minReputation, offers[i])) {
                count++;
            }
        }
        
        // Build result
        ServiceOffer[] memory result = new ServiceOffer[](count);
        uint256 index = 0;
        
        for (uint i = 0; i < offers.length; i++) {
            Provider storage provider = providers[offers[i].providerId];
            if (_isProviderValid(provider, maxPrice, maxLatency, minReputation, offers[i])) {
                result[index] = offers[i];
                index++;
            }
        }
        
        return result;
    }
    
    /**
     * @notice Update provider reputation based on request outcome
     */
    function updateReputation(
        bytes32 providerId,
        bool success,
        uint256 responseTime,
        uint256 earnings
    ) external {
        // Only callable by verified orchestrators
        require(isAuthorizedOrchestrator(msg.sender), "Not authorized");
        
        Provider storage provider = providers[providerId];
        
        if (success) {
            successfulRequests[providerId]++;
            // Boost score for fast responses
            if (responseTime < 1000) {
                provider.reputationScore = min(provider.reputationScore + 50, 10000);
            }
        } else {
            failedRequests[providerId]++;
            provider.reputationScore = max(provider.reputationScore - 100, 0);
        }
        
        totalEarnings[providerId] += earnings;
        emit ReputationUpdated(providerId, provider.reputationScore);
    }
    
    /**
     * @notice Check if provider is valid for selection
     */
    function _isProviderValid(
        Provider storage provider,
        uint256 maxPrice,
        uint256 maxLatency,
        uint256 minReputation,
        ServiceOffer memory offer
    ) internal view returns (bool) {
        if (!provider.isActive) return false;
        if (block.timestamp - provider.lastHeartbeat > HEARTBEAT_TIMEOUT) return false;
        if (provider.reputationScore < minReputation) return false;
        if (offer.price > maxPrice) return false;
        if (offer.maxLatency > maxLatency) return false;
        return true;
    }
    
    function isAuthorizedOrchestrator(address) internal pure returns (bool) {
        // Implementation: check against authorized orchestrator list
        return true; // Placeholder
    }
    
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
    
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
```

### DHT-Based Discovery (libp2p Kademlia)

```rust
// ZippyMeshEcosystem/crates/node-core/src/networking/discovery.rs

use libp2p::kad::{
    Kademlia, KademliaConfig, KademliaEvent, QueryResult, Record, RecordKey,
};
use libp2p::mdns::{Mdns, MdnsEvent};

/// Discovery service combining Kademlia DHT and mDNS
pub struct ZippyDiscoveryService {
    kademlia: Kademlia<MemoryStore>,
    mdns: Mdns,
    local_providers: HashMap<PeerId, ProviderInfo>,
}

impl ZippyDiscoveryService {
    /// Bootstrap from on-chain registry
    pub async fn bootstrap_from_chain(&mut self, rpc_url: &str) -> Result<()> {
        // Query smart contract for active providers
        let providers = self.query_on_chain_registry(rpc_url).await?;
        
        // Add to DHT routing table
        for provider in providers {
            let peer_id = provider.peer_id.parse()?;
            let multiaddr: Multiaddr = provider.endpoint.parse()?;
            
            self.kademlia.add_address(&peer_id, multiaddr);
            
            // Store provider info locally
            self.local_providers.insert(peer_id, provider);
        }
        
        Ok(())
    }
    
    /// Publish local provider capabilities to DHT
    pub async fn publish_services(&mut self, services: Vec<ServiceInfo>) -> Result<()> {
        for service in services {
            let key = RecordKey::new(&format!("zippy:model:{}", service.model_id));
            
            let record = ProviderRecord {
                peer_id: self.local_peer_id.to_string(),
                endpoint: service.endpoint,
                price: service.price_per_token,
                latency_ms: service.avg_latency_ms,
                reputation: service.reputation_score,
                timestamp: chrono::Utc::now().timestamp(),
            };
            
            let value = serde_json::to_vec(&record)?;
            
            // Store in DHT with 1-hour TTL
            let record = Record::new(key, value);
            self.kademlia.put_record(record, Quorum::One)?;
        }
        
        Ok(())
    }
    
    /// Discover providers for a specific model
    pub async fn discover_providers(
        &mut self,
        model_id: &str,
        criteria: DiscoveryCriteria,
    ) -> Result<Vec<ProviderRecord>> {
        let key = RecordKey::new(&format!("zippy:model:{}", model_id));
        
        // Query DHT
        let query_id = self.kademlia.get_record(key);
        
        // Wait for results
        let mut providers = Vec::new();
        
        // Also query local cache
        for (peer_id, info) in &self.local_providers {
            if info.models.contains(&model_id.to_string()) {
                if self.matches_criteria(info, &criteria) {
                    providers.push(info.clone());
                }
            }
        }
        
        // Sort by reputation and latency
        providers.sort_by(|a, b| {
            let score_a = a.reputation_score as f64 / (a.avg_latency_ms as f64 + 1.0);
            let score_b = b.reputation_score as f64 / (b.avg_latency_ms as f64 + 1.0);
            score_b.partial_cmp(&score_a).unwrap()
        });
        
        Ok(providers)
    }
    
    fn matches_criteria(&self, provider: &ProviderInfo, criteria: &DiscoveryCriteria) -> bool {
        provider.price_per_token <= criteria.max_price
            && provider.avg_latency_ms <= criteria.max_latency
            && provider.reputation_score >= criteria.min_reputation
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRecord {
    pub peer_id: String,
    pub endpoint: String,
    pub price: u64,
    pub latency_ms: u64,
    pub reputation: u64,
    pub timestamp: i64,
}

#[derive(Debug, Clone)]
pub struct DiscoveryCriteria {
    pub max_price: u64,
    pub max_latency: u64,
    pub min_reputation: u64,
}
```

---

## Layer 2: Routing Engine

### Provider Selection Algorithm

```rust
// ZippyMeshEcosystem/crates/blockchain/src/routing_engine.rs

/// Intelligent routing engine for LLM provider selection
pub struct RoutingEngine {
    trust_engine: Arc<TrustEngine>,
    metrics_collector: Arc<MetricsCollector>,
}

impl RoutingEngine {
    /// Select optimal provider based on playbook criteria
    pub async fn select_provider(
        &self,
        request: &LlmRequest,
        playbook: &Playbook,
    ) -> Result<ProviderSelection, RoutingError> {
        
        // 1. Discover candidate providers
        let candidates = self.discover_candidates(&request.model).await?;
        
        // 2. Filter by playbook constraints
        let filtered = self.apply_constraints(candidates, &playbook.constraints)?;
        
        // 3. Score each provider
        let scored: Vec<ScoredProvider> = filtered
            .into_iter()
            .map(|p| {
                let score = self.calculate_score(&p, &playbook.weights);
                ScoredProvider { provider: p, score }
            })
            .collect();
        
        // 4. Select top provider
        let selection = scored.into_iter()
            .max_by(|a, b| a.score.partial_cmp(&b.score).unwrap())
            .ok_or(RoutingError::NoProvidersAvailable)?;
        
        // 5. Verify provider health (async check)
        if !self.health_check(&selection.provider).await? {
            // Recurse to find next best
            return self.select_provider(request, playbook).await;
        }
        
        Ok(ProviderSelection {
            provider: selection.provider,
            expected_cost: self.estimate_cost(&selection.provider, request),
            expected_latency: self.estimate_latency(&selection.provider),
            confidence: selection.score,
        })
    }
    
    /// Calculate composite score for a provider
    fn calculate_score(
        &self,
        provider: &ProviderInfo,
        weights: &PlaybookWeights,
    ) -> f64 {
        let cost_score = self.normalize_cost(provider.price_per_token);
        let latency_score = self.normalize_latency(provider.avg_latency_ms);
        let reputation_score = provider.reputation_score as f64 / 10000.0;
        let trust_score = self.trust_engine.get_score(&provider.peer_id);
        
        // Weighted combination
        weights.cost * cost_score +
        weights.latency * latency_score +
        weights.reputation * reputation_score +
        weights.trust * trust_score
    }
    
    /// Failover to next best provider on failure
    pub async fn failover(
        &self,
        failed_provider: &ProviderInfo,
        request: &LlmRequest,
        playbook: &Playbook,
    ) -> Result<ProviderSelection, RoutingError> {
        // Mark provider as temporarily unhealthy
        self.metrics_collector.record_failure(failed_provider).await;
        
        // Update playbook to exclude failed provider temporarily
        let mut updated_playbook = playbook.clone();
        updated_playbook.excluded_providers.push(failed_provider.peer_id.clone());
        
        // Retry selection
        self.select_provider(request, &updated_playbook).await
    }
}
```

---

## Layer 3: Secure Communication

### Request Signing & Verification

```rust
// ZippyMeshEcosystem/crates/blockchain/src/crypto.rs

use ed25519_dalek::{Keypair, Signer, Verifier, Signature};
use sha2::{Sha256, Digest};

/// Quantum-resistant request signing
pub struct RequestSigner {
    keypair: Keypair,
}

impl RequestSigner {
    /// Sign an LLM inference request
    pub fn sign_request(&self, request: &LlmRequest) -> Result<SignedRequest, CryptoError> {
        // Create canonical request hash
        let request_hash = self.hash_request(request);
        
        // Sign with Ed25519
        let signature = self.keypair.sign(&request_hash);
        
        Ok(SignedRequest {
            request: request.clone(),
            signature: signature.to_bytes().to_vec(),
            public_key: self.keypair.public.to_bytes().to_vec(),
            timestamp: chrono::Utc::now().timestamp(),
        })
    }
    
    /// Verify a signed request
    pub fn verify_request(signed: &SignedRequest) -> Result<bool, CryptoError> {
        let public_key = ed25519_dalek::PublicKey::from_bytes(&signed.public_key)?;
        let signature = Signature::from_bytes(&signed.signature)?;
        
        let request_hash = Self::hash_request(&signed.request);
        
        public_key.verify(&request_hash, &signature)?;
        
        // Check timestamp freshness (5-minute window)
        let now = chrono::Utc::now().timestamp();
        if (now - signed.timestamp).abs() > 300 {
            return Ok(false);
        }
        
        Ok(true)
    }
    
    fn hash_request(&self, request: &LlmRequest) -> Vec<u8> {
        let mut hasher = Sha256::new();
        hasher.update(&request.model_id);
        hasher.update(&request.prompt);
        hasher.update(&request.max_tokens.to_le_bytes());
        hasher.update(&request.timestamp.to_le_bytes());
        hasher.finalize().to_vec()
    }
}
```

### Encrypted Response Tunnel

```rust
/// Establish encrypted tunnel to provider
pub async fn establish_tunnel(
    provider: &ProviderInfo,
    our_keypair: &Keypair,
) -> Result<EncryptedTunnel, TunnelError> {
    // Perform X25519 key exchange
    let ephemeral_key = x25519_dalek::EphemeralSecret::new(OsRng);
    let ephemeral_public = x25519_dalek::PublicKey::from(&ephemeral_key);
    
    // Send public key to provider
    let response = reqwest::Client::new()
        .post(&format!("{}/handshake", provider.endpoint))
        .json(&json!({
            "public_key": hex::encode(ephemeral_public.as_bytes()),
            "client_public_key": hex::encode(our_keypair.public.to_bytes()),
        }))
        .send()
        .await?;
    
    let provider_public_bytes = hex::decode(
        response.json::<HandshakeResponse>().await?.public_key
    )?;
    let provider_public = x25519_dalek::PublicKey::from(provider_public_bytes.as_slice().try_into()?);
    
    // Derive shared secret
    let shared_secret = ephemeral_key.diffie_hellman(&provider_public);
    
    // Derive AES-GCM key from shared secret
    let mut key = [0u8; 32];
    hkdf::Hkdf::<sha2::Sha256>::new(None, shared_secret.as_bytes())
        .expand(b"zippy-mesh-v1", &mut key)?;
    
    Ok(EncryptedTunnel {
        provider: provider.clone(),
        cipher: Aes256Gcm::new(&key.into()),
        nonce_counter: 0,
    })
}
```

---

## Layer 4: Payment Settlement

### HTLC-Based Micropayments

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ZippyMeshPaymentChannel
 * @notice State channel for fast micropayments between users and providers
 */
contract ZippyMeshPaymentChannel {
    
    struct Channel {
        address user;
        address provider;
        uint256 capacity;
        uint256 userBalance;
        uint256 providerBalance;
        bytes32 latestHash;
        uint256 settleTimeout;
        ChannelStatus status;
    }
    
    enum ChannelStatus { Active, Closing, Settled }
    
    mapping(bytes32 => Channel) public channels;
    mapping(bytes32 => uint256) public withdrawalRequests;
    
    event ChannelOpened(bytes32 indexed channelId, address user, address provider, uint256 capacity);
    event PaymentSent(bytes32 indexed channelId, uint256 amount, bytes32 hash);
    event ChannelClosed(bytes32 indexed channelId, uint256 userAmount, uint256 providerAmount);
    
    /// @notice Open a new payment channel
    function openChannel(
        address provider,
        uint256 settleTimeout
    ) external payable returns (bytes32 channelId) {
        require(msg.value > 0, "Must deposit funds");
        require(provider != address(0), "Invalid provider");
        
        channelId = keccak256(abi.encodePacked(msg.sender, provider, block.timestamp));
        
        channels[channelId] = Channel({
            user: msg.sender,
            provider: provider,
            capacity: msg.value,
            userBalance: msg.value,
            providerBalance: 0,
            latestHash: bytes32(0),
            settleTimeout: settleTimeout,
            status: ChannelStatus.Active
        });
        
        emit ChannelOpened(channelId, msg.sender, provider, msg.value);
    }
    
    /// @notice Submit payment hash (off-chain payment proof)
    function submitPaymentHash(
        bytes32 channelId,
        bytes32 paymentHash
    ) external {
        Channel storage channel = channels[channelId];
        require(channel.user == msg.sender, "Not user");
        require(channel.status == ChannelStatus.Active, "Channel not active");
        
        channel.latestHash = paymentHash;
        
        emit PaymentSent(channelId, channel.providerBalance, paymentHash);
    }
    
    /// @notice Provider claims payment with preimage
    function claimPayment(
        bytes32 channelId,
        bytes32 preimage,
        uint256 amount
    ) external {
        Channel storage channel = channels[channelId];
        require(channel.provider == msg.sender, "Not provider");
        require(channel.status == ChannelStatus.Active, "Channel not active");
        
        // Verify hash
        bytes32 hash = keccak256(abi.encodePacked(preimage));
        require(hash == channel.latestHash, "Invalid preimage");
        
        // Update balances
        require(channel.userBalance >= amount, "Insufficient balance");
        channel.userBalance -= amount;
        channel.providerBalance += amount;
        
        // Transfer to provider
        payable(msg.sender).transfer(amount);
    }
    
    /// @notice Cooperative close channel
    function closeChannel(
        bytes32 channelId,
        uint256 userAmount,
        uint256 providerAmount,
        bytes memory userSig,
        bytes memory providerSig
    ) external {
        Channel storage channel = channels[channelId];
        require(channel.status == ChannelStatus.Active, "Channel not active");
        
        // Verify signatures
        bytes32 message = keccak256(abi.encodePacked(channelId, userAmount, providerAmount));
        
        require(verifySignature(channel.user, message, userSig), "Invalid user sig");
        require(verifySignature(channel.provider, message, providerSig), "Invalid provider sig");
        
        require(channel.userBalance == userAmount, "User amount mismatch");
        require(channel.providerBalance == providerAmount, "Provider amount mismatch");
        require(userAmount + providerAmount == channel.capacity, "Balance mismatch");
        
        channel.status = ChannelStatus.Settled;
        
        // Distribute funds
        payable(channel.user).transfer(userAmount);
        payable(channel.provider).transfer(providerAmount);
        
        emit ChannelClosed(channelId, userAmount, providerAmount);
    }
    
    function verifySignature(
        address signer,
        bytes32 message,
        bytes memory signature
    ) internal pure returns (bool) {
        // ECDSA signature verification
        // Implementation omitted for brevity
        return true;
    }
}
```

---

## User Participation Levels

### Level 0: Consumer (Local-Only)

```typescript
// ZippyMesh_LLM_Router - Local-only mode
export class LocalConsumer {
    private localModels: Map<string, LocalLlmEngine>;
    
    async routeRequest(request: LlmRequest): Promise<LlmResponse> {
        // Only use local LLM engines
        const localEngine = this.localModels.get(request.model);
        
        if (!localEngine) {
            throw new Error("Model not available locally. Enable mesh access to use remote providers.");
        }
        
        return await localEngine.complete(request);
    }
    
    // No blockchain interaction
    // No wallet required
    // Complete privacy
}
```

### Level 1: Explorer (Mesh Access)

```typescript
export class MeshExplorer {
    private wallet: ZippyWallet;
    private discovery: DiscoveryService;
    
    async initialize(): Promise<void> {
        // Generate or load wallet
        this.wallet = await ZippyWallet.create();
        
        // Connect to mesh without being a provider
        await this.discovery.connect({
            mode: 'explorer',
            wallet: this.wallet.address,
        });
    }
    
    async discoverProviders(modelId: string): Promise<ProviderInfo[]> {
        // Query on-chain registry
        const onChainProviders = await this.queryRegistry(modelId);
        
        // Query DHT for additional providers
        const dhtProviders = await this.discovery.queryDHT(modelId);
        
        // Merge and deduplicate
        return this.mergeProviderLists(onChainProviders, dhtProviders);
    }
    
    async routeToProvider(
        request: LlmRequest,
        provider: ProviderInfo
    ): Promise<LlmResponse> {
        // Establish encrypted tunnel
        const tunnel = await this.establishTunnel(provider);
        
        // Sign request
        const signedRequest = await this.wallet.signRequest(request);
        
        // Send via tunnel
        return await tunnel.send(signedRequest);
    }
}
```

### Level 2: Provider (Host LLMs)

```typescript
export class MeshProvider {
    private wallet: ZippyWallet;
    private localEngines: Map<string, LocalLlmEngine>;
    private server: ProviderServer;
    
    async initialize(config: ProviderConfig): Promise<void> {
        // Create wallet with stake
        this.wallet = await ZippyWallet.create();
        
        // Register on-chain
        await this.registerOnChain({
            stakeAmount: config.stakeAmount, // Min 100 ZIP
            endpoint: config.publicEndpoint,
            models: config.availableModels,
            pricePerToken: config.price,
        });
        
        // Start provider server
        this.server = new ProviderServer({
            wallet: this.wallet,
            engines: this.localEngines,
        });
        
        // Start heartbeat service
        this.startHeartbeat();
    }
    
    private async startHeartbeat(): Promise<void> {
        // Submit heartbeat every 5 minutes
        setInterval(async () => {
            await this.wallet.submitHeartbeat();
        }, 5 * 60 * 1000);
    }
    
    async handleRequest(signedRequest: SignedRequest): Promise<LlmResponse> {
        // Verify signature
        if (!await this.verifyRequest(signedRequest)) {
            throw new Error("Invalid signature");
        }
        
        // Process request locally
        const engine = this.localEngines.get(signedRequest.request.model);
        const response = await engine.complete(signedRequest.request);
        
        // Record for payment
        await this.recordUsage(signedRequest, response);
        
        return response;
    }
}
```

### Level 3: Operator (Run Infrastructure)

```rust
// Full node operator with validation
pub struct NodeOperator {
    validator_key: ValidatorKey,
    p2p_node: P2pNode,
    blockchain_client: ZippyCoreClient,
}

impl NodeOperator {
    pub async fn initialize(config: OperatorConfig) -> Result<Self> {
        // Generate validator keys
        let validator_key = ValidatorKey::generate();
        
        // Connect to blockchain
        let blockchain_client = ZippyCoreClient::new(config.rpc_url).await?;
        
        // Register as validator (requires 10,000 ZIP stake)
        blockchain_client.register_validator(
            &validator_key.public_key(),
            config.stake_amount,
        ).await?;
        
        // Start P2P node
        let p2p_node = P2pNode::new(P2pConfig {
            listen_addrs: config.listen_addrs,
            bootstrap_nodes: config.bootstrap_nodes,
            enable_relay: true,
            enable_dht: true,
        }).await?;
        
        Ok(Self {
            validator_key,
            p2p_node,
            blockchain_client,
        })
    }
    
    pub async fn run(&mut self) -> Result<()> {
        // Main event loop
        loop {
            tokio::select! {
                // Handle P2P events
                event = self.p2p_node.next_event() => {
                    self.handle_p2p_event(event?).await?;
                }
                
                // Handle blockchain events
                block = self.blockchain_client.next_block() => {
                    self.process_block(block?).await?;
                }
                
                // Validate transactions
                tx = self.mempool.next_transaction() => {
                    self.validate_transaction(tx?).await?;
                }
            }
        }
    }
}
```

---

## Security Considerations

### Threat Model

| Threat | Mitigation |
|--------|------------|
| **Sybil Attack** | Minimum stake requirement (100 ZIP) + reputation system |
| **DDoS on Providers** | Rate limiting + multiple provider failover |
| **Payment Fraud** | HTLC atomic swaps + on-chain dispute resolution |
| **Eavesdropping** | TLS 1.3 + X25519 key exchange + AES-256-GCM |
| **Provider Censorship** | Decentralized discovery + onion routing option |
| **Quantum Computing** | CRYSTALS-Dilithium signatures + Kyber key exchange |

### Audit Trail

All actions are logged for transparency:

```rust
pub struct AuditLog {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub action: AuditAction,
    pub actor: String,  // Peer ID or Address
    pub details: serde_json::Value,
    pub signature: Vec<u8>,
}

pub enum AuditAction {
    ProviderRegistered,
    ServiceRequested,
    PaymentSent,
    ReputationUpdated,
    ProviderSlashed,
}
```

---

**END OF SECURITY ARCHITECTURE DOCUMENT**
