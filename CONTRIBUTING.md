# Contributing to Zippy Mesh LLM Router

Thank you for your interest in contributing. ZMLR is a source-available product by Zippy Technologies LLC. Community contributions are genuinely welcome — they make the product better for everyone, from solo hobbyists to enterprise customers.

This document covers the contributor license agreement, development setup, the public/private repo split, PR workflow, code style, and plugin development.

---

## Contributor License Agreement (CLA)

**By submitting any contribution** to this repository — whether by pull request, GitHub issue, email, or any other means — **you automatically agree** to the following terms (also set out in [LICENSE](LICENSE) Section 9):

> You grant Zippy Technologies LLC a **perpetual, irrevocable, worldwide, non-exclusive, royalty-free license** to reproduce, modify, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute your contribution as part of the Product.
>
> You represent that: (a) your contribution is your original work or you have the right to submit it, (b) it does not violate any third party's rights, and (c) you are legally entitled to grant the above license.

**What this means in plain terms:**
- You keep copyright on your work — you are not signing it away
- You're giving us a license to use your contribution in ZMLR and future versions of it
- We cannot use your contribution outside the Product (as a standalone commercialized work) without your consent
- No signature or separate form is required — submitting a contribution constitutes acceptance

If your contribution is work-for-hire or created on behalf of an employer, ensure your employer has authorized you to submit it under these terms.

---

## Table of Contents

1. [Development Setup](#1-development-setup)
2. [Public vs Private Repository Split](#2-public-vs-private-repository-split)
3. [Submitting Pull Requests](#3-submitting-pull-requests)
4. [Code Style](#4-code-style)
5. [Plugin Development](#5-plugin-development)
6. [Reporting Issues](#6-reporting-issues)

---

## 1. Development Setup

### Requirements

- **Node.js** 20 or later (LTS recommended)
- **npm** 10 or later
- **Git**
- **Optional:** [Ollama](https://ollama.com) for local model support and semantic cache features
- **Optional:** [Rust + Tauri CLI](https://tauri.app/start/prerequisites/) for desktop app development (`npm run tauri`)

### First-time setup

```bash
# 1. Clone the community edition repository
git clone https://github.com/GoZippy/zippymesh-router
cd zippymesh-router

# 2. Install dependencies
npm install

# 3. Create your local environment file
cp .env.example .env

# 4. Edit .env — set at minimum:
#   JWT_SECRET=<32+ random characters>
# Generate a secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Your dashboard password is set via the /setup wizard on first run.

# 5. Start the development server
npm run dev
```

The dashboard runs at `http://localhost:20128` by default. The OpenAI-compatible API endpoint is at the same base URL: `http://localhost:20128/v1/chat/completions`.

### Running tests

```bash
# Unit tests (fast, no network required)
npm run test:unit

# Provider adapter tests (requires provider credentials in .env)
npm run test:providers

# Full integration smoke test
npm test
```

### Building for production

```bash
# Standard Next.js production build
npm run build:next

# Build the community edition package (strips proprietary stubs, see Section 2)
npm run build:community

# Build standalone binary with Tauri (requires Rust toolchain)
npm run tauri build
```

### Data directory

By default, all runtime data is stored in `./data/` relative to the project root. This includes:

- `db.json` — lowdb JSON store (settings, provider configs, OAuth metadata)
- `zmlr.sqlite` — SQLite database (traces, cache, virtual keys, model registry)
- `routing_memory.json` — per-client routing history
- `oauth-secrets.json` — encrypted OAuth tokens

The data directory is never committed to git. Override it with `DATA_DIR=/path/to/data` in `.env`.

---

## 2. Public vs Private Repository Split

ZMLR has two codebases that share the same version number:

| Repository | Contents | Audience |
|---|---|---|
| **Private repo** | Full implementation including P2P networking, ZippyCoin wallet, trust scoring, and marketplace backend | ZippyMesh team only |
| **Community repo** (this one) | Core routing engine, playbook system, provider connectors, dashboard UI, MCP server — with proprietary modules replaced by interface stubs | Public contributors |

### What is open in the community edition

- Core routing engine (`src/lib/routing/`)
- Playbook schema and execution logic
- Provider connector interfaces and OAuth flows
- Model catalog and discovery (`src/lib/discovery/`)
- Prompt cache and semantic cache
- Guardrails engine
- Dashboard UI components
- API route handlers
- MCP server definition
- All documentation

### What is replaced with stubs

The following modules exist in the community repo as stubs that export the correct interface but return an informative error when called:

- `src/lib/discovery/p2pDiscovery.js` — P2P mesh networking
- `src/lib/zippycoin-wallet.js` — ZippyCoin EVM wallet
- `src/lib/trustScore.js` — Peer trust scoring
- `src/lib/wallet-management.js` — Wallet management utilities
- Dashboard pages: `wallet/`, `monetization/`, `network/`

Stub files contain the comment `// Community Edition Stub` at the top. Do not submit pull requests that modify stub files — those interfaces are maintained in the private repo and synchronized automatically.

### How the split is maintained

A build script (`scripts/build-community.sh`) reads a `.zippy-private` manifest and replaces proprietary files with their corresponding stubs before producing the community release. This script runs in CI on every version tag. Contributors never need to run this script manually.

Version numbers are synchronized: if the private repo is at `v0.5.1`, the community repo is also tagged `v0.5.1`.

---

## 3. Submitting Pull Requests

### What to contribute

Contributions are welcome in the following areas:

- Bug fixes in the core routing engine, playbook system, or provider connectors
- New provider integrations (implement the standard provider interface)
- Guardrail rules and pattern improvements
- Dashboard UI improvements
- Documentation improvements
- New plugin implementations
- Test coverage improvements
- Performance improvements with benchmark evidence

### What to avoid

- Do not submit PRs that touch stub files (`// Community Edition Stub`)
- Do not submit PRs that introduce new proprietary-tier features (P2P, wallet, trust scoring) — those belong in the private repo
- Do not submit PRs that add new npm dependencies without prior discussion in an issue

### PR workflow

1. **Open an issue first** for any non-trivial change. Describe the problem and your proposed solution. Wait for a maintainer to confirm the approach before writing code. This saves everyone time.

2. **Fork the repository** and create a branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

3. **Make your changes.** Keep commits focused. One logical change per commit. Write a clear commit message explaining _why_, not just _what_.

4. **Write or update tests** for your change. PRs without tests for new behavior will be asked to add them.

5. **Run the test suite locally** before pushing:
   ```bash
   npm run test:unit
   npm run secrets:check
   ```

6. **Open a PR against `main`.** Fill in the PR template:
   - What problem does this solve?
   - How was it tested?
   - Are there any breaking changes?
   - Screenshots for UI changes

7. **Address review feedback.** Maintainers will review within 5 business days. Incorporate feedback with new commits — do not force-push over the review history.

8. **Merge:** A maintainer will squash-merge the PR when approved.

### Commit message style

Follow conventional commits format:

```
type(scope): short summary in present tense

Longer explanation if needed. Wrap at 72 chars.
Reference issues: Closes #123
```

Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`

Examples:
```
feat(routing): add dry-run simulation endpoint for playbooks
fix(cache): normalize message whitespace before SHA-256 hashing
docs(quickstart): add Vercel AI SDK integration example
```

---

## 4. Code Style

The project uses ESLint with the Next.js config (`eslint-config-next`). Run the linter with:

```bash
npx eslint src/
```

### General rules

- **JavaScript/ES modules** throughout. No TypeScript in the application code (the project uses `jsconfig.json` for editor intelligence).
- **ES module syntax** (`import`/`export`). No CommonJS `require()` in `src/` (only allowed in `scripts/` and config files where noted).
- **Async/await** over raw Promises. Always `await` before calling `.json()` on a Response object.
- **SQLite (better-sqlite3):** All calls are synchronous. Do not `await` them. Do not wrap them in `new Promise()`. Respect the sync nature of the library.
- **Error handling:** Use the `apiError()` and `errorResponse()` helpers from `src/lib/apiErrors.js` for all API route error responses. Do not return bare `{ error: "string" }` objects.
- **Secrets:** Never hardcode secrets, API keys, or passwords. Use environment variables. Run `npm run secrets:check` before committing.

### File and directory conventions

```
src/app/api/           — Next.js App Router API routes (route.js files)
src/app/(dashboard)/   — Dashboard page components
src/lib/               — Shared server-side utility modules
src/lib/routing/       — Core routing pipeline modules
src/lib/providers/     — Provider-specific connector code
src/lib/discovery/     — Model catalog and discovery services
src/lib/maintenance/   — Background jobs and scheduled tasks
src/shared/            — Code shared between client and server components
```

### Naming conventions

- Files: `camelCase.js` for modules, `PascalCase.js` for React components
- Functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE` for module-level constants, `camelCase` for local
- Database tables: `snake_case`
- API routes: `kebab-case` URL paths

### Adding a new API route

1. Create `src/app/api/[category]/[resource]/route.js`
2. Export named functions: `GET`, `POST`, `PUT`, `DELETE` (only the methods your route handles)
3. Use `withAuth` middleware from `src/lib/auth/middleware.js` for all routes that require authentication
4. Return `NextResponse.json(data, { status: 200 })` for success
5. Return `apiError(message, code, status)` for errors
6. Document the route in the API Reference section of `docs/`

---

## 5. Plugin Development

ZMLR supports three plugin types: **provider**, **guardrail**, and **routing-rule**. Plugins are loaded from `~/.zippy-mesh/plugins/` at startup.

See `ROADMAP.md` Task 4.2 for the full plugin architecture specification.

### Quick start: provider plugin

Create a directory at `~/.zippy-mesh/plugins/my-provider/` with an `index.js`:

```js
// ~/.zippy-mesh/plugins/my-provider/index.js

export default {
  type: 'provider',
  name: 'my-provider',
  version: '1.0.0',
  description: 'My custom LLM provider',

  async init(config) {
    // config comes from the user's plugin settings in the dashboard
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.my-provider.com/v1';
  },

  async listModels() {
    // Return an array of normalized model objects
    return [
      {
        id: 'plugin:my-provider/my-model-v1',
        name: 'My Model v1',
        contextWindow: 32000,
        inputPricePerMTokens: 0.50,
        outputPricePerMTokens: 1.50,
        capabilities: ['chat', 'code'],
      },
    ];
  },

  async chatCompletion(body) {
    // body is an OpenAI-compatible request object
    // Return an OpenAI-compatible response object
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return response.json();
  },

  async getHealth() {
    // Return { ok: true } if the provider is reachable and the key is valid
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return { ok: res.ok };
    } catch {
      return { ok: false, message: 'Connection failed' };
    }
  },
};
```

### Quick start: guardrail plugin

```js
export default {
  type: 'guardrail',
  name: 'my-guardrail',
  version: '1.0.0',
  description: 'Custom content filter',

  async init(config) {},

  async checkRequest(messages) {
    const allText = messages.map(m => m.content).join(' ');
    if (allText.includes('forbidden-phrase')) {
      return {
        allowed: false,
        reason: 'Request contains a prohibited phrase',
      };
    }
    // Optionally return modified messages
    return { allowed: true };
  },
};
```

### Plugin guidelines

- Plugins must not `import` from `src/lib/localDb.js` — no direct database access
- Plugins must not store secrets in their own files — receive config from the ZMLR settings system via `init(config)`
- Plugins are loaded with standard Node.js `import()` — they run in the same process as ZMLR, not sandboxed
- Only install plugins from sources you trust
- If your plugin makes network requests, respect the user's proxy settings (available via `process.env.HTTPS_PROXY`)
- Plugin models appear in the catalog with the prefix `plugin:[name]/` to avoid ID collisions with built-in providers

### Submitting a plugin to the community

Plugins are maintained as separate repositories. To have your plugin listed in the ZMLR documentation:

1. Publish it to npm with the package name prefix `zmlr-plugin-`
2. Add the `zmlr-plugin` keyword to your `package.json`
3. Open an issue in this repo with the label `plugin-listing` linking to your npm package

---

## 6. Reporting Issues

Use GitHub Issues for:

- Bug reports (include ZMLR version, OS, Node.js version, and steps to reproduce)
- Feature requests (describe the use case, not just the feature)
- Documentation gaps

Use GitHub Discussions for:

- Questions about configuration and setup
- Architecture and design discussions
- Plugin development help

**Security vulnerabilities:** Do not open a public issue. Email [Support@GoZippy.com](mailto:Support@GoZippy.com) with subject `[SECURITY] ZMLR — <description>`. See [SECURITY.md](SECURITY.md) for the full responsible disclosure policy.

---

## Recognition

Contributors whose PRs are merged are listed in the project's contributors section. Significant contributions may be highlighted in release notes. We are genuinely grateful for every contribution — from a one-line doc fix to a full provider integration.

---

## Licensing

By contributing, you confirm you have read and accept the [Contributor License Agreement](#contributor-license-agreement-cla) section at the top of this document.

ZMLR is source-available under the [Zippy Technologies Source-Available Commercial License v1.3](LICENSE). Personal and educational use is free. Commercial use requires a paid license — see [PRICING.md](PRICING.md) for details.

Contributing to ZMLR does not grant you a commercial license. If you use your contribution in a commercial context, the standard commercial license terms apply.

---

*Zippy Technologies LLC — Wichita, Kansas*
[Support@GoZippy.com](mailto:Support@GoZippy.com) | [GitHub Discussions](https://github.com/GoZippy/zippymesh-router/discussions)
