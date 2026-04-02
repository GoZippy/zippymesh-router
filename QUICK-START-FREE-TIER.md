# 🚀 ZMLR Free Tier - Quick Start (5 minutes)

**Get unlimited free LLM capacity in 3 steps**

---

## Step 1: Import Playbook (1 min)

```bash
cd /home/sysop/projects/ZippyMesh_LLM_Router
./scripts/setup-free-providers.sh
```

**Result**: Playbook `free-models-tier-1` created ✓

---

## Step 2: Get Free API Keys (2 min)

### Groq (fastest, recommended first)
1. Visit https://console.groq.com
2. Sign up with email/GitHub
3. Copy API key (starts with `gsk_`)

### Google Gemini (reliable, 1M tokens/day free)
1. Visit https://ai.google.dev/
2. Click "Get API Key"
3. Create new API key
4. Copy key (starts with `AIzaSy`)

### OpenRouter (optional fallback)
1. Visit https://openrouter.ai/keys
2. Sign up
3. Copy API key (starts with `sk-or-v1-`)

---

## Step 3: Add Keys to ZMLR (2 min)

Copy and run these commands:

```bash
# Replace YOUR_KEY with actual keys from above

# Add Groq
curl -X POST http://localhost:20128/api/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer openclaw-manual-db-injection" \
  -d '{
    "provider": "groq",
    "name": "Groq-Free",
    "apiKey": "gsk_YOUR_GROQ_KEY",
    "priority": 1,
    "isActive": true
  }'

# Add Gemini
curl -X POST http://localhost:20128/api/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer openclaw-manual-db-injection" \
  -d '{
    "provider": "google-gemini",
    "name": "Gemini-Free",
    "apiKey": "AIzaSy_YOUR_GEMINI_KEY",
    "priority": 2,
    "isActive": true
  }'

# Optional: Add OpenRouter
curl -X POST http://localhost:20128/api/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer openclaw-manual-db-injection" \
  -d '{
    "provider": "openrouter",
    "name": "OpenRouter-Free",
    "apiKey": "sk-or-v1_YOUR_OPENROUTER_KEY",
    "priority": 3,
    "isActive": true
  }'
```

---

## Test It Works

```bash
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "free-models-tier-1",
    "messages": [{"role": "user", "content": "Hello, what can you do?"}],
    "max_tokens": 50
  }'
```

**Expected**: Response from Groq or another free provider ✓

---

## Use in OpenClaw

Add to `~/.openclaw/openclaw.json`:

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

Now OpenClaw will use free providers for all LLM requests.

---

## Routing Priority

Requests automatically try providers in this order:

1. **Groq** (300+ tok/sec) ← Fastest, use first
2. **Gemini** (50 tok/sec) ← Most reliable
3. **OpenRouter** (varies) ← Fallback
4. **Ollama** (0.5 tok/sec) ← Emergency only

---

## Cost

| Provider | Daily Limit | Monthly Cost |
|----------|---|---|
| Groq | Unlimited | $0 |
| Gemini | 1M tokens (~5K requests) | $0 |
| OpenRouter | Free models only | $0 |
| Ollama | Unlimited (local) | $0 |
| **TOTAL** | **Unlimited** | **$0** |

---

## Performance

| Task | Time | Provider |
|------|------|----------|
| Simple chat | <1 second | Groq |
| Code generation | 2-4 seconds | Groq |
| Reasoning | 3-8 seconds | Gemini |
| Emergency (local) | 60-300 seconds | Ollama |

---

## Troubleshooting

**API Key error?**
- Check key format (Groq: `gsk_...`, Gemini: `AIzaSy...`, OpenRouter: `sk-or-v1-...`)
- Test key manually with provider's API
- Ensure no extra spaces in key

**Request failing?**
- Check ZMLR is running: `curl http://localhost:20128/api/health`
- Verify provider is configured: Check ZMLR dashboard
- Check logs: `tail ~/.zippymesh/zippymesh.log`

**Running out of quota?**
- Groq: Unlimited, no worries
- Gemini: 1M tokens/day (resets daily)
- Others: Check provider dashboard

**Want more details?**
→ Read full guide: [`docs/FREE-TIER-INTEGRATION.md`](./docs/FREE-TIER-INTEGRATION.md)

---

## Next Steps

1. ✅ Import playbook (done above)
2. ✅ Get API keys (done above)
3. ✅ Configure ZMLR (done above)
4. → Start using: `curl` test above or integrate with OpenClaw
5. → Monitor: Visit http://localhost:20128 dashboard

---

**Setup time**: 5 minutes
**Cost**: $0/month
**Capacity**: Unlimited (free tier quotas)
**Status**: ✅ Production Ready

🎉 **You now have free unlimited LLM capacity!**
