# Privacy Posture

ZippyMesh is a **local-first** AI router. Its job is to talk to the AI providers
**you** configure — and nothing else by default.

## What ZippyMesh sends, and when

| Destination | When it happens | Default |
|---|---|---|
| **AI provider APIs** (OpenAI, Anthropic, OpenRouter, Google, Groq, …) | Only providers you connect, only when you make requests through them | required for routing |
| **Telemetry / heartbeat** (`zippymesh.com`) | Only after you connect an account **and** enable the `telemetry` permission | **off** (not connected) |
| **Cloud sync** (`NEXT_PUBLIC_CLOUD_URL`) | Only when you enable cloud sync (`cloudEnabled`) | **off** |
| **Hosted endpoints** (`zippymesh.com`) | Only when `enableHostedEndpoints` is on | **off** |
| **Activation check** | Only when `ACTIVATION_API_URL`/`ACTIVATION_API_KEY` env are set | **off** (unset) |

There are **no third-party analytics/telemetry SDKs** bundled (no Sentry,
PostHog, Segment, Google Analytics, Mixpanel, etc.). Verify with
`grep -iE "posthog|segment|sentry|mixpanel|amplitude|analytics" package.json`.

## Defaults that protect you

- **Binds to `127.0.0.1` (loopback) by default** — not reachable from other
  machines unless you explicitly opt into LAN exposure (`ZIPPY_BIND_HOST=0.0.0.0`
  or `npm run dev:lan`/`start:lan`). The app warns loudly if you expose it on the
  network with login disabled.
- **No phone-home on startup.** Telemetry init is a no-op unless you've connected
  an account and turned telemetry on.
- **Experimental (Labs) features are off by default** and never send data.

## Offline / Privacy mode (hard switch)

For a one-switch guarantee, enable **offline mode**:

- env: `ZIPPY_OFFLINE=true`, or
- setting: `offlineMode: true`

When on, **all non-provider outbound is hard-disabled** (telemetry + heartbeat),
even if an account is connected. You can still use every AI provider you've
configured — ZippyMesh just won't talk to anything else.

## Remote commands

If you connect an account *and* enable the `remoteCommands` permission, the
server may send control commands (e.g. switch active playbook). This is **off by
default** and requires explicit opt-in. Offline mode disables the channel.

## Where your data lives

Provider keys/tokens, usage, and config are stored **locally** in `db.json`
(under `DATA_DIR` or `~/.zippymesh`). Secrets in the Vault are encrypted at rest.
Nothing in this list leaves your machine unless a row in the table above applies.
