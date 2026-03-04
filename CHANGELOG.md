# v0.2.0-alpha (2026-03-01)

## Features
- Trust score and ServiceRegistry integration (optional)
- Plugin architecture (manifest, nav, routes); LLM default plugin; stub dVPN/compute
- Docker and sidecar port alignment (9480)
- .env.example: JWT_SECRET, INITIAL_PASSWORD, DATA_DIR

## Security
- Removed hardcoded credentials; use INITIAL_PASSWORD from env only
- NOTICE.md and SECURITY.md added

## Fixes
- docker-compose: SIDE_CAR_URL and sidecar ports aligned to 9480
- sidecar Dockerfile: correct binary name (zippy-mesh-sidecar)
- Settings sync: use SIDE_CAR_URL for node pricing

---

# v0.2.27 (2026-01-15)

## Features
- Added Kiro Provider with generous free quota

## Bug Fixes
- Fixed Codex Provider bugs

# v0.2.21 (2026-01-12)

## Changes
- Update ReadMe
- Fix bug **antigravity**

