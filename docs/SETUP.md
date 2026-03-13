# ZippyMesh LLM Router - Standalone Setup Guide

This guide covers setting up ZippyMesh LLM Router as a standalone service.

## System Requirements

- **Node.js**: 18.x or higher
- **OS**: Windows, macOS, or Linux
- **RAM**: 512MB minimum, 1GB+ recommended
- **Disk**: 100MB for installation, plus space for logs

## Quick Start

### 1. Download & Extract

Download the latest release and extract to a folder:

```bash
# Example
unzip zippymesh-router-v0.3.0-alpha.zip -d ~/zippymesh
cd ~/zippymesh
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and set required values:

```env
# Security (REQUIRED for production)
JWT_SECRET=your-random-32-char-secret-here
API_KEY_SECRET=another-random-secret-here

# Initial admin password (optional)
INITIAL_PASSWORD=your-admin-password

# Port (default: 20128)
PORT=20128

# Data directory (optional, uses platform default if not set)
# DATA_DIR=/path/to/data
```

### 3. Start the Router

**Windows:**
```cmd
start-stable.cmd
```

**macOS/Linux:**
```bash
chmod +x start-stable.sh
./start-stable.sh
```

Or manually:
```bash
cd .next/standalone
PORT=20128 node server.js
```

### 4. Access the Dashboard

Open your browser to: http://localhost:20128

## First-Time Setup

1. **Login** (if password set): Use the password from `INITIAL_PASSWORD` or the one you set
2. **Add Providers**: Go to Providers page and add your API keys
3. **Test Connection**: Click "Test" on each provider to verify
4. **Create Router API Key**: Go to Profile page to create API keys for external clients

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 20128 | Server port |
| `HOSTNAME` | localhost | Bind address (use `0.0.0.0` for network access) |
| `DATA_DIR` | Platform-specific | Custom data directory |
| `JWT_SECRET` | (random) | Session encryption key |
| `API_KEY_SECRET` | (random) | API key encryption |
| `INITIAL_PASSWORD` | (none) | Initial admin password |

### Data Directory Locations

- **Windows**: `%APPDATA%\zippy-mesh`
- **macOS**: `~/.zippy-mesh`
- **Linux**: `~/.zippy-mesh`

Data includes:
- `db.json` - Configuration and settings
- `zippymesh.db` - SQLite database (usage, models)
- `log.txt` - Request logs

## Running as a Service

### Windows (NSSM)

1. Download [NSSM](https://nssm.cc/download)
2. Install as service:

```cmd
nssm install ZippyMesh "C:\path\to\node.exe" "server.js"
nssm set ZippyMesh AppDirectory "C:\path\to\zippymesh\.next\standalone"
nssm set ZippyMesh AppEnvironmentExtra "PORT=20128"
nssm start ZippyMesh
```

### Linux (systemd)

Create `/etc/systemd/system/zippymesh.service`:

```ini
[Unit]
Description=ZippyMesh LLM Router
After=network.target

[Service]
Type=simple
User=zippymesh
WorkingDirectory=/opt/zippymesh/.next/standalone
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PORT=20128
Environment=HOSTNAME=0.0.0.0

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable zippymesh
sudo systemctl start zippymesh
```

### PM2

```bash
cd .next/standalone
pm2 start server.js --name zippymesh --env PORT=20128
pm2 save
pm2 startup
```

## Using with AI Tools

### Cursor

In Cursor settings, set the API endpoint:
```
http://localhost:20128/v1
```

Add your router API key if `requireApiKey` is enabled.

### Claude Code / MCP

Point MCP clients to:
```
http://localhost:20128/v1/chat/completions
```

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:20128/v1",
    api_key="your-router-api-key"
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## Network Access

To allow access from other machines:

1. Set `HOSTNAME=0.0.0.0` in `.env`
2. Open firewall port: `20128` (TCP)
3. Use machine IP instead of localhost

## Security Recommendations

1. **Enable Authentication**:
   - Enable `Require login` in Profile settings
   - Enable `Require API key` for /v1/* endpoints

2. **Use Strong Secrets**:
   - Set `JWT_SECRET` and `API_KEY_SECRET` to random 32+ char strings

3. **Firewall**:
   - Only expose port 20128 to trusted networks

4. **HTTPS**:
   - Use a reverse proxy (nginx, Caddy) for HTTPS in production

## Upgrading

1. Stop the running service
2. Backup your data directory
3. Download and extract new version
4. Run `npm run build:standalone` (if building from source)
5. Start the service

Data persists in the user data directory and survives upgrades.

## Troubleshooting

### Port Already in Use

Change the port in `.env`:
```env
PORT=20129
```

### Cannot Connect to Providers

1. Check API key is correct
2. Test connection in Providers page
3. Check provider status page for outages

### Data Not Persisting

Verify data directory permissions:
```bash
ls -la ~/.zippy-mesh/
```

### High Memory Usage

Restart the service periodically or increase Node.js memory:
```bash
NODE_OPTIONS="--max-old-space-size=2048" node server.js
```

## Support

- Documentation: [docs/](.)
- GitHub Issues: Report bugs and feature requests
- API Reference: [docs/API.md](./API.md)
