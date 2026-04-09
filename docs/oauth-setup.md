# OAuth App-Level Credentials Setup

ZippyMesh LLM Router uses OAuth 2.0 to authenticate users with third-party AI providers. This requires two distinct types of credentials:

| Type | Who sets it | Stored where | Example |
|------|------------|--------------|---------|
| **App-level secret** | ZMLR deployer (once per install) | `.env` file | `ANTIGRAVITY_CLIENT_SECRET=...` |
| **User token** | End user (via OAuth flow in dashboard) | `DATA_DIR/oauth-secrets.json` (encrypted) | access/refresh token |

This document covers the **app-level secrets**. User tokens are handled automatically by the dashboard OAuth flows.

---

## Why are app-level secrets needed?

Each OAuth provider requires a registered application with a `client_id` and `client_secret`. ZMLR ships with the `client_id` values embedded (they are public identifiers). The `client_secret` must be kept out of source code but needs to be present at runtime so ZMLR can exchange authorization codes and refresh tokens on behalf of users.

These secrets are **the same for all users** of your ZMLR instance. They are application credentials, not user credentials.

---

## Provider Setup

### Antigravity (Google Gemini Code Assist)

ZMLR uses the Gemini Code Assist OAuth application to authenticate users with Google Cloud's Gemini API via the `cloudcode-pa.googleapis.com` endpoint.

**Required env var:** `ANTIGRAVITY_CLIENT_SECRET`

Add to your `.env`:
```
ANTIGRAVITY_CLIENT_SECRET=GOCSPX-...
```

The secret can be found in the resources of the Antigravity IDE application if installed locally (`/usr/share/antigravity/resources/app/out/main.js`), or obtained by registering your own OAuth app at [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth 2.0 Client ID.

---

### Gemini CLI

Used for the `gemini-cli` provider (standard Gemini API via Google accounts).

**Required env var:** `GEMINI_CLIENT_SECRET`

Add to your `.env`:
```
GEMINI_CLIENT_SECRET=GOCSPX-...
```

Same source as Antigravity — both use Google OAuth. If you have one, you likely have the other.

---

### iFlow

Used for the `iflow` provider (iflow.cn AI service).

**Required env var:** `IFLOW_CLIENT_SECRET`

Add to your `.env`:
```
IFLOW_CLIENT_SECRET=...
```

Obtain from iflow.cn developer settings.

---

## Verifying your setup

After setting secrets in `.env`, run:

```bash
npm run check-env
```

This will report which providers have their secrets configured and which are missing.

---

## Providers that do NOT need app-level secrets

These providers use per-user API keys or device-code flows with no shared app secret:

| Provider | Auth method |
|----------|------------|
| Kilo.ai | API key (get from app.kilo.ai/profile) |
| GitHub Copilot | Device code (no secret needed) |
| Ollama | None (local) |
| OpenAI | API key |
| Anthropic | API key |
| Kiro | Device code (AWS SSO OIDC, registers its own client) |
| Qwen | Device code (PKCE, no secret) |
| Claude.ai | PKCE (no secret) |
| Codex | PKCE (no secret) |

---

## Security notes

- Never commit real secret values to git — `.env` is in `.gitignore`
- Secrets are read at startup from the environment — ZMLR does not write them to the database
- Per-user OAuth tokens (access/refresh) are stored encrypted in `DATA_DIR/oauth-secrets.json` and are separate from these app-level secrets
- Run `npm run secrets:check` (part of the build pipeline) to scan for accidentally committed secrets
