# ZippyMesh Network Assessment Report

**Date:** 2026-03-02  
**Scanner:** network-scanner.js v1.0  
**Scope:** Proxmox VMs, Docker Desktop, Local Services

---

## Executive Summary

The network scan reveals a **partially operational** ZippyCoin infrastructure with **critical connectivity issues** that must be addressed before production deployment.

### Key Findings:

| Status | Metric |
|--------|--------|
| ✅ Good | 4/4 validators are online and responding to RPC |
| ✅ Good | All validators on correct Chain ID 777 |
| ✅ Good | Docker services fully operational |
| ✅ Good | Local ZippyMesh API responding |
| ⚠️ Critical | **All validators have 0 peers** - Network is fragmented |
| ⚠️ Critical | Block numbers diverging - No consensus |
| ❌ Bad | Backend API VM offline (10.0.97.210) |
| ❌ Bad | Monitoring VM offline (10.0.97.220) |
| ❌ Bad | P2P Discovery service not running locally |

---

## Detailed Findings

### 1. ZippyCoin Validators

All validators are accessible but **NOT CONNECTED TO EACH OTHER**.

| VM | IP | Block # | Peers | Status |
|----|----|---------|-------|--------|
| genesis-validator | 10.0.97.100 | 1,631,579 | 0 | ⚠️ No peers |
| validator2 | 10.0.97.101 | 1,631,538 | 0 | ⚠️ No peers |
| validator3 | 10.0.97.102 | 1,631,301 | 0 | ⚠️ No peers |
| fullnode | 10.0.97.200 | 1,631,358 | 0 | ⚠️ No peers |

**Analysis:**
- Block numbers are diverging (1,631,579 vs 1,631,301 = 278 block difference)
- This indicates each validator is running independently
- P2P port 30303 is closed on all validators
- Cassandra port 9042 is closed on validators

### 2. Docker Desktop Services

All ZippyMesh Docker services are running correctly:

| Service | Port | Status |
|---------|------|--------|
| ZippyMesh API | 31000 | ✅ Running |
| Redis | 31001 | ✅ Running |
| PostgreSQL | 31003 | ✅ Running |
| Orchestrator | 31005 | ✅ Running |

### 3. Local ZippyMesh

| Component | Port | Status |
|-----------|------|--------|
| HTTP API | 20128 | ✅ Running (models endpoint responding) |
| P2P Discovery | 20129 | ❌ Not running |

**Issue:** P2P discovery is disabled. The beacon service needs to be started for mesh networking.

### 4. Offline Services

| VM | IP | Expected Ports | Issue |
|----|----|----------------|-------|
| backend | 10.0.97.210 | 3000, 4000, 5000 | VM not responding |
| monitoring | 10.0.97.220 | 9090, 3000, 8080 | VM not responding |

---

## Critical Issues (Must Fix)

### Issue #1: Validator P2P Network Down 🔴

**Problem:** Validators are not peering with each other.

**Impact:**
- No blockchain consensus
- Each validator on different fork
- Transactions not propagating
- Network security compromised

**Root Causes:**
1. P2P port 30303/tcp and 30303/udp likely firewalled
2. Bootstrap nodes not configured in validator config
3. Network discovery protocol not running

**Fix Steps:**
```bash
# 1. Open firewall on each validator
sudo ufw allow 30303/tcp
sudo ufw allow 30303/udp

# 2. Update validator config with bootstrap nodes
# Add to config.toml:
# bootstrap-nodes = ["enode://...genesis-validator...", "enode://...validator2..."]

# 3. Restart validators with peering enabled
```

### Issue #2: Divergent Blockchains 🔴

**Problem:** Block numbers differ by 278 blocks between validators.

**Impact:**
- Double-spend possible
- Inconsistent state across network
- Cannot reach finality

**Fix Steps:**
1. Identify validator with highest block (genesis: 1,631,579)
2. Sync other validators from this node
3. Consider chain wipe and resync if forks are deep

### Issue #3: Missing Backend & Monitoring 🟡

**Problem:** Two VMs are completely offline.

**Impact:**
- No centralized API for external clients
- No metrics/monitoring
- Difficult to troubleshoot issues

**Fix Steps:**
1. Check VM power state in Proxmox
2. Verify network connectivity
3. Review VM startup logs

### Issue #4: P2P Discovery Not Running 🟡

**Problem:** Local ZippyMesh not broadcasting presence.

**Impact:**
- Cannot discover mesh providers automatically
- Users must manually add nodes
- Reduced mesh network effect

**Fix Steps:**
```javascript
// Start the discovery beacon
const { discoveryService } = require('./src/lib/discovery/localDiscovery');
await discoveryService.startBeacon();
```

---

## Network Architecture (Current State)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Current Network State                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Validator 1 │  │ Validator 2 │  │ Validator 3 │             │
│  │ 1,631,579   │  │ 1,631,538   │  │ 1,631,301   │             │
│  │ Peers: 0    │  │ Peers: 0    │  │ Peers: 0    │             │
│  │ ⚠️ ISOLATED │  │ ⚠️ ISOLATED │  │ ⚠️ ISOLATED │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                    │
│         └────────────────┴────────────────┘                    │
│                          ❌ NO CONNECTIONS                      │
│                                                                 │
│  ┌─────────────────────────────────────────────┐               │
│  │     Docker Desktop (Local)                  │               │
│  │  ✅ API ✅ Redis ✅ PostgreSQL ✅ Orch     │               │
│  └──────────────────────┬──────────────────────┘               │
│                         │                                      │
│                    ┌────┴────┐                                 │
│                    │ZippyMesh│                                 │
│                    │ :20128  │                                 │
│                    │ ✅ HTTP │                                 │
│                    │ ❌ P2P  │                                 │
│                    └─────────┘                                 │
│                                                                 │
│  ❌ Backend VM (10.0.97.210) - OFFLINE                         │
│  ❌ Monitoring VM (10.0.97.220) - OFFLINE                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Upgrade Plan

### Phase 1: Fix Critical Connectivity (URGENT)

**Priority:** 🔴 HIGH - Do immediately

1. **Fix Validator Peering**
   - Open firewall ports 30303/tcp and 30303/udp on all validators
   - Configure bootstrap nodes in validator config
   - Restart validators
   - Verify peer count > 0 on all nodes

2. **Sync Blockchains**
   - Stop validators 2, 3, and fullnode
   - Wipe chain data (backup first!)
   - Sync from genesis validator (highest block)
   - Verify block numbers match

3. **Start Offline VMs**
   - Power on backend VM (10.0.97.210)
   - Power on monitoring VM (10.0.97.220)
   - Verify services start correctly

### Phase 2: Enable Mesh Features

**Priority:** 🟡 MEDIUM - This week

1. **Enable P2P Discovery**
   - Start UDP beacon service on port 20129
   - Configure node identity
   - Test peer discovery between local and remote nodes

2. **Configure Service Registry**
   - Deploy ServiceRegistry smart contract
   - Implement heartbeat protocol (60s interval)
   - Register existing providers

3. **Setup Provider Directory**
   - Create provider metadata schema
   - Implement reputation scoring
   - Build discovery API

### Phase 3: Production Hardening

**Priority:** 🟢 NORMAL - Next 2 weeks

1. **Security**
   - Enable TLS on all RPC endpoints
   - Implement JWT authentication
   - Setup firewall rules for all services

2. **Monitoring**
   - Deploy Prometheus on monitoring VM
   - Configure Grafana dashboards
   - Setup alerting for validator health

3. **Backup & Recovery**
   - Automated chain snapshots
   - VM backup schedule
   - Disaster recovery procedures

---

## Recommended Configuration Changes

### Validator Config (apply to all)

```toml
# Network
p2p-port = 30303
max-peers = 50
bootstrap-nodes = [
  "enode://<genesis-validator-enode>@10.0.97.100:30303",
  "enode://<validator2-enode>@10.0.97.101:30303",
  "enode://<validator3-enode>@10.0.97.102:30303"
]

# RPC
rpc-port = 8545
rpc-addr = "0.0.0.0"
rpc-api = ["eth", "net", "zippycoin", "admin"]

# Discovery
discovery-enabled = true
discovery-port = 30303
```

### Firewall Rules (all validators)

```bash
# Allow P2P
sudo ufw allow 30303/tcp
sudo ufw allow 30303/udp

# Allow RPC (restricted to internal network)
sudo ufw allow from 10.0.97.0/24 to any port 8545

# Allow Cassandra (validators only)
sudo ufw allow from 10.0.97.0/24 to any port 9042
```

### ZippyMesh Local Config

```bash
# .env.local
ZIPPY_DISCOVERY_PORT=20129
ZIPPY_BEACON_INTERVAL=30000
ZIPPY_NODE_NAME=local-dev-node
NEXT_PUBLIC_ZIPPYCOIN_RPC_URL=http://10.0.97.100:8545
```

---

## Next Steps

1. **Immediate (Today):**
   - Fix validator peering (firewall + config)
   - Start offline VMs
   - Verify blockchain sync

2. **This Week:**
   - Deploy ServiceRegistry contract
   - Enable P2P discovery locally
   - Test mesh provider discovery

3. **Next Week:**
   - Create wallet generation module
   - Implement user participation framework
   - Build provider onboarding flow

4. **Testing:**
   - Run 72-hour stability test
   - Verify all validators maintain sync
   - Test failover scenarios

---

## Appendix: Quick Commands

### Check Validator Peers
```bash
curl -X POST http://10.0.97.100:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'
```

### Check Block Number
```bash
curl -X POST http://10.0.97.100:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Test ZippyMesh API
```bash
curl http://localhost:20128/api/v1/models
```

### Restart All Validators
```bash
# Run on each validator
sudo systemctl restart zippycoin-validator
```

---

**Report Generated:** 2026-03-02T21:35:57.168Z  
**Next Review:** After Phase 1 fixes complete