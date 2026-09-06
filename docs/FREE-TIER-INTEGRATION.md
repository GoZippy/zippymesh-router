# Free Tier LLM Provider Integration for ZMLR

**Status**: ✅ Production Ready
**Date**: March 16, 2026
**Version**: 1.0.0

---

## Overview

This integration enables ZMLR to route requests to free/freemium LLM providers (Groq, Google Gemini, OpenRouter) with automatic fallback to local Ollama. Zero cost for most use cases.

## Quick Start (5 minutes)

### 1. Import Playbook

The playbook is automatically imported by the setup script:

```bash
cd /path/to/ZippyMesh_LLM_Router
./scripts/setup-free-providers.sh
```

**Result**: `free-models-tier-1` playbook created in ZMLR database ✓

### 2. Add Free Provider API Keys to ZMLR

Get free API keys:
- **Groq** (unlimited free): https://console.groq.com → Copy `gsk_...` key
- **Gemini** (1M tokens/day): https://ai.google.dev/ → Copy `AIzaSy...` key
- **OpenRouter** (optional): https://openrouter.ai/keys → Copy `sk-or-v1-...` key

**Add to ZMLR via REST API:**

```bash
# Add Groq
curl -X POST http://localhost:20128/api/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer openclaw-manual-db-injection" \
  -d '{
    "provider": "groq",
    "authType": "apikey",
    "name": "Groq-Free",
    "apiKey": "gsk_YOUR_KEY",
    "priority": 1,
    "isActive": true
  }'

# Add Gemini
curl -X POST http://localhost:20128/api/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer openclaw-manual-db-injection" \
  -d '{
    "provider": "google-gemini",
    "authType": "apikey",
    "name": "Gemini-Free",
    "apiKey": "AIzaSy_YOUR_KEY",
    "priority": 2,
    "isActive": true
  }'

# Add OpenRouter (optional)
curl -X POST http://localhost:20128/api/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer openclaw-manual-db-injection" \
  -d '{
    "provider": "openrouter",
    "authType": "apikey",
    "name": "OpenRouter-Free",
    "apiKey": "sk-or-v1_YOUR_KEY",
    "priority": 3,
    "isActive": true
  }'
```

### 3. Use the Playbook

**Via OpenClaw:**
```bash
# Request will automatically route to free-models-tier-1 playbook
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "free-models-tier-1",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**Via Intent Header:**
```bash
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-ZippyMesh-Intent: free_fast" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**Via OpenClaw Integration:**
Edit `openclaw.json`:
```json
{
  "providers": [
    {
      "name": "zippymesh-free",
      "baseUrl": "http://127.0.0.1:20128/v1",
      "model": "free-models-tier-1",
      "apiType": "openai-completions",
      "apiKey": "openclaw-manual-db-injection"
    }
  ]
}
```

## Architecture

### Request Flow

```
User Request
    ↓
ZMLR Router
├─ Check: Model = "free-models-tier-1"?
├─ Load: Playbook rules
└─ Apply: Filtering + Boost scores
    ↓
Provider Selection
├─ Groq (score: 1000) - Try first
├─ Gemini (score: 2000) - If Groq fails
├─ OpenRouter (score: 3000) - If Gemini fails
└─ Ollama (score: 100000) - Emergency only
    ↓
Response
```

### Playbook Rules

| Rule | Provider | Score | Purpose |
|------|----------|-------|---------|
| filter-in | groq | - | Only allow free providers |
| filter-in | gemini | - | Only allow free providers |
| filter-in | openrouter | - | Only allow free providers |
| filter-in | ollama | - | Only allow free providers |
| boost | groq | 1000 | Prioritize fastest (300 tok/sec) |
| boost | gemini | 2000 | Secondary (50 tok/sec) |
| boost | openrouter | 3000 | Tertiary (2-30 sec) |
| boost | ollama | 100000 | Last resort (0.5 tok/sec) |
| cost-threshold | * | 0 | No paid models allowed |

## Performance Characteristics

| Provider | Speed | Cost | Best For | Context |
|----------|-------|------|----------|---------|
| **Groq** | 300+ tok/sec | Free ∞ | Speed-critical tasks | 8K tokens |
| **Gemini** | 50 tok/sec | Free 1M/day | Reasoning, vision | 1M tokens |
| **OpenRouter** | 2-30s/req | Free models | Fallback, variety | Varies |
| **Ollama** | 0.5 tok/sec | Free (local) | Emergency only | 4K tokens |

## Cost Analysis

### Monthly Budget
- **Groq**: $0 (unlimited)
- **Gemini**: $0 (1M tokens/day ≈ 5K requests)
- **OpenRouter**: $0 (free models)
- **Ollama**: $0 (electricity only)
- **TOTAL**: **$0/month**

### Quota Limits
| Provider | Limit | Window | Mitigation |
|----------|-------|--------|-----------|
| Groq | Unlimited | ∞ | Primary choice |
| Gemini | 1M tokens | 24h | Automatic rollover, Groq backup |
| OpenRouter | Free models only | ∞ | Unlimited for free tier |
| Ollama | Unlimited | ∞ | Emergency fallback |

## Integration with Existing ZMLR

### Files Added
```
docs/
├── example-playbooks/
│   └── free-models-tier-1.json          # Playbook definition
└── FREE-TIER-INTEGRATION.md             # This file

scripts/
└── setup-free-providers.sh              # Setup automation
```

### Files Modified
None - fully compatible with existing ZMLR infrastructure.

### API Compatibility
✅ Uses existing ZMLR endpoints:
- `POST /api/routing/playbooks` - Import playbook
- `POST /api/providers` - Add provider
- `POST /v1/chat/completions` - Route requests
- `GET /api/health` - Health check

## Deployment Guide

### Option A: Automatic Setup (Recommended)

```bash
# 1. Navigate to ZMLR directory
cd /path/to/ZippyMesh_LLM_Router

# 2. Run setup script
./scripts/setup-free-providers.sh

# 3. Follow instructions to add API keys
# (Copy commands from script output)

# 4. Test
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "free-models-tier-1",
    "messages": [{"role": "user", "content": "test"}]
  }'
```

### Option B: Manual Setup

```bash
# 1. Import playbook manually
curl -X POST http://localhost:20128/api/routing/playbooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer openclaw-manual-db-injection" \
  -d @docs/example-playbooks/free-models-tier-1.json

# 2. Add providers individually (see Quick Start section 2)

# 3. Verify
curl http://localhost:20128/api/health
```

## Testing & Validation

### Health Check
```bash
curl http://localhost:20128/api/health
```

Should return:
```json
{
  "ok": true,
  "providersConfigured": 3,
  "providersActive": 1,
  "status": "ok"
}
```

### Test Routing

```bash
# Test with Groq
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "free-models-tier-1",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "max_tokens": 10
  }'
```

Expected: Response from Groq (or fallback provider if Groq unavailable)

### Monitor Routing

```bash
# Check which provider handled request (via response headers)
curl -v -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "free-models-tier-1", "messages": [{"role": "user", "content": "test"}]}' \
  2>&1 | grep "X-Routed"
```

## Troubleshooting

### Playbook Not Routing
**Problem**: Requests ignore free-models-tier-1 playbook

**Solutions**:
```bash
# 1. Verify playbook exists
curl -s "http://localhost:20128/api/routing/playbooks" \
  -H "Authorization: Bearer openclaw-manual-db-injection" | grep "free-models-tier-1"

# 2. Check if providers are active
curl http://localhost:20128/api/health

# 3. Verify playbook is imported correctly
curl -s "http://localhost:20128/api/routing/playbooks" \
  -H "Authorization: Bearer openclaw-manual-db-injection" | jq '.[] | select(.name=="free-models-tier-1")'
```

### API Key Errors
**Problem**: "Invalid API key" or provider fails

**Solutions**:
```bash
# 1. Verify key format:
# Groq: gsk_... (40+ chars)
# Gemini: AIzaSy... (starts with AIzaSy)
# OpenRouter: sk-or-v1-... (starts with sk-or-v1-)

# 2. Test key manually
curl -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer gsk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "llama-3.1-70b-versatile", "messages": [{"role": "user", "content": "test"}]}'
```

### Falling Back to Local Ollama
**Normal behavior**: If all cloud providers fail, automatically falls back to local Ollama (slow but works)

**To force Ollama-only**:
```bash
# Edit playbook to only include ollama
# OR request with different playbook that includes local-only
```

## Monitoring & Analytics

### Usage Tracking
ZMLR automatically logs:
- Which provider handled each request
- Tokens consumed
- Latency
- Provider routing metadata

**Access logs** via ZMLR dashboard at `http://localhost:20128`

### Cost Tracking
With all providers free-tier:
- **Daily cost**: $0
- **Monthly cost**: $0
- **Tracking**: Automated via request logs

## Future Enhancements

### Phase 2: Multi-Tier Playbooks (Planned)
- `free-models-tier-1-fast`: Speed-optimized (Groq primary)
- `free-models-tier-1-reliable`: Reliability-optimized (Gemini primary)
- `free-models-tier-1-reasoning`: Reasoning-optimized (Gemini + reasoning models)

### Phase 3: Lite ZMLR Distribution (Planned)
Free-only version of ZMLR:
- Pre-configured for free providers
- Simplified onboarding
- Option to add paid providers later

### Phase 4: Provider Auto-Detection (Planned)
- Auto-detect free provider availability
- Automatic quota tracking
- Proactive alerts on quota limits

## Support & Documentation

### Related Files
- ZMLR Playbooks: `/docs/PLAYBOOKS.md`
- OpenClaw Integration: `/docs/ZIPPYMESH-OPENCLAW-INTEGRATION-GUIDE.md`
- Setup Script: `/scripts/setup-free-providers.sh`
- Example Playbook: `/docs/example-playbooks/free-models-tier-1.json`

### Resources
- Groq Console: https://console.groq.com
- Google Gemini: https://ai.google.dev/
- OpenRouter: https://openrouter.ai/keys
- ZMLR GitHub: (your repo URL)

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-03-16 | 1.0.0 | Initial release: free-models-tier-1 playbook, setup automation |

---

**Status**: ✅ Production Ready
**Last Updated**: 2026-03-16
**Maintainer**: ZMLR Project
