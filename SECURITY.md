# Security

## Trust Model

- **No telemetry** — the router does not phone home or send usage analytics.
- **No inference logging** — prompts and responses are not logged unless you enable `ENABLE_REQUEST_LOGS`.
- **Keys stay local** — provider credentials and API keys are stored in your local data directory.

## Production Deployment

1. Set `JWT_SECRET` to a strong random value (32+ characters).
2. Set `INITIAL_PASSWORD` and change it on first login.
3. Do not use default credentials in production.
4. Use HTTPS when exposing the dashboard externally.

## Reporting Vulnerabilities

Please report security issues privately. Do not open public issues for vulnerabilities.
