#!/usr/bin/env bash
# =============================================================================
# ZippyMesh LLM Router — Upgrade Script
# Usage: bash upgrade.sh <path-to-new-zip>
#   e.g. bash upgrade.sh ~/Downloads/zippymesh-router-v0.3.2-alpha.zip
#
# What this does:
#   1. Detects your current install directory and service type
#   2. Stops the running service
#   3. Backs up your .env (your data in DATA_DIR is never touched)
#   4. Extracts the new zip over the existing install directory
#   5. Restores your .env
#   6. Merges any new .env.example keys that are missing from your .env
#   7. Restarts the service
#   8. Verifies the new version is responding
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[upgrade]${NC} $*"; }
success() { echo -e "${GREEN}[upgrade]${NC} $*"; }
warn()    { echo -e "${YELLOW}[upgrade]${NC} $*"; }
die()     { echo -e "${RED}[upgrade] ERROR:${NC} $*"; exit 1; }

# ── Args ──────────────────────────────────────────────────────────────────────
ZIP="${1:-}"
[[ -z "$ZIP" ]] && die "Usage: bash upgrade.sh <path-to-new-zip>"
[[ -f "$ZIP" ]] || die "File not found: $ZIP"
ZIP="$(realpath "$ZIP")"
NEW_VERSION="$(basename "$ZIP" | grep -oP 'v[\d\.\-a-z]+(?=\.zip)' || echo 'unknown')"

# ── Detect install directory ───────────────────────────────────────────────────
# Strategy: find the currently running server.js process and trace back to install root
INSTALL_DIR=""

# 1. Try to find from systemd service (Linux)
if command -v systemctl &>/dev/null; then
  for scope in "--user" ""; do
    SVC_FILE=$(systemctl $scope show zippy-mesh.service --property=FragmentPath --value 2>/dev/null || true)
    if [[ -n "$SVC_FILE" && -f "$SVC_FILE" ]]; then
      INSTALL_DIR=$(grep -oP '(?<=WorkingDirectory=).*' "$SVC_FILE" || true)
      break
    fi
  done
fi

# 2. Try to find from running process
if [[ -z "$INSTALL_DIR" ]]; then
  PID=$(pgrep -f "next-server\|server\.js" | head -1 || true)
  if [[ -n "$PID" ]]; then
    INSTALL_DIR=$(ls -la /proc/$PID/cwd 2>/dev/null | awk '{print $NF}' || true)
  fi
fi

# 3. Common default locations
if [[ -z "$INSTALL_DIR" ]]; then
  for d in "$HOME/zippymesh" "$HOME/zippy-mesh" "/opt/zippymesh" "/opt/zippy-mesh"; do
    if [[ -f "$d/server.js" || -f "$d/package.json" ]]; then
      INSTALL_DIR="$d"; break
    fi
  done
fi

[[ -z "$INSTALL_DIR" ]] && die "Could not detect install directory. Set it manually: INSTALL_DIR=/path/to/zippymesh bash upgrade.sh <zip>"
[[ -f "$INSTALL_DIR/server.js" || -f "$INSTALL_DIR/package.json" ]] || die "Install directory doesn't look right: $INSTALL_DIR"

CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('$INSTALL_DIR/package.json'))['version'])" 2>/dev/null || echo "unknown")

info "Install directory : $INSTALL_DIR"
info "Current version   : $CURRENT_VERSION"
info "Upgrading to      : $NEW_VERSION"
echo ""

# ── Stop service ──────────────────────────────────────────────────────────────
SERVICE_STOPPED=false
SERVICE_TYPE=""

# Try systemd user service
if systemctl --user is-active zippy-mesh.service &>/dev/null 2>&1; then
  info "Stopping systemd user service..."
  systemctl --user stop zippy-mesh.service
  SERVICE_TYPE="systemd-user"
  SERVICE_STOPPED=true
# Try systemd system service
elif sudo systemctl is-active zippy-mesh.service &>/dev/null 2>&1; then
  info "Stopping systemd system service..."
  sudo systemctl stop zippy-mesh.service
  SERVICE_TYPE="systemd-system"
  SERVICE_STOPPED=true
else
  # Try to find and kill a running node process
  PID=$(pgrep -f "zippy-mesh\|zippymesh\|server\.js" | head -1 || true)
  if [[ -n "$PID" ]]; then
    warn "No systemd service found. Stopping process $PID..."
    kill "$PID" 2>/dev/null || true
    sleep 2
    SERVICE_TYPE="process"
    SERVICE_STOPPED=true
  else
    warn "No running ZippyMesh service found. Proceeding with upgrade anyway."
  fi
fi

# ── Backup .env ────────────────────────────────────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
ENV_BACKUP=""
if [[ -f "$ENV_FILE" ]]; then
  ENV_BACKUP="$(mktemp /tmp/zippymesh-env-backup.XXXXXX)"
  cp "$ENV_FILE" "$ENV_BACKUP"
  info "Backed up .env to $ENV_BACKUP"
fi

# ── Extract zip ────────────────────────────────────────────────────────────────
info "Extracting $ZIP..."
TMPDIR="$(mktemp -d /tmp/zippymesh-upgrade.XXXXXX)"
unzip -q "$ZIP" -d "$TMPDIR"

# The zip may have a single top-level folder or extract directly
EXTRACTED="$TMPDIR"
ENTRIES=("$TMPDIR"/*)
if [[ ${#ENTRIES[@]} -eq 1 && -d "${ENTRIES[0]}" ]]; then
  EXTRACTED="${ENTRIES[0]}"
fi

# Copy new files over install dir (preserve DATA_DIR which is outside install)
info "Installing new files..."
cp -r "$EXTRACTED"/. "$INSTALL_DIR/"
success "Files installed."

rm -rf "$TMPDIR"

# ── Restore .env ───────────────────────────────────────────────────────────────
if [[ -n "$ENV_BACKUP" ]]; then
  cp "$ENV_BACKUP" "$ENV_FILE"
  success "Restored .env"

  # Merge any NEW keys from .env.example that aren't in the user's .env
  EXAMPLE="$INSTALL_DIR/.env.example"
  if [[ -f "$EXAMPLE" ]]; then
    ADDED=0
    while IFS= read -r line; do
      # Only process non-comment, non-empty KEY= lines
      if [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)= ]]; then
        KEY="${BASH_REMATCH[1]}"
        # If this key is NOT already in user's .env, append it (commented out)
        if ! grep -q "^${KEY}=" "$ENV_FILE" 2>/dev/null; then
          if [[ $ADDED -eq 0 ]]; then
            echo "" >> "$ENV_FILE"
            echo "# ── Added by upgrade to $NEW_VERSION ──" >> "$ENV_FILE"
          fi
          echo "# $line" >> "$ENV_FILE"
          ADDED=$((ADDED + 1))
        fi
      fi
    done < "$EXAMPLE"
    [[ $ADDED -gt 0 ]] && warn "$ADDED new config keys added (commented out) to .env — review and uncomment as needed"
  fi
  rm -f "$ENV_BACKUP"
fi

# ── Restart service ────────────────────────────────────────────────────────────
if [[ "$SERVICE_STOPPED" == true ]]; then
  info "Restarting service..."
  case "$SERVICE_TYPE" in
    "systemd-user")   systemctl --user start zippy-mesh.service ;;
    "systemd-system") sudo systemctl start zippy-mesh.service ;;
    "process")        warn "Started as a background process — for a permanent service, set up systemd (see docs/RUNNING.md)" ;
                      cd "$INSTALL_DIR" && nohup node server.js >> /tmp/zippy-mesh.log 2>&1 & ;;
  esac
  sleep 3
fi

# ── Verify ─────────────────────────────────────────────────────────────────────
# Detect port from .env
PORT=$(grep -oP '(?<=^PORT=)\d+' "$ENV_FILE" 2>/dev/null || echo "20128")
HEALTH_URL="http://localhost:$PORT/api/health"

info "Checking $HEALTH_URL ..."
RESPONSE=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "")
if [[ -n "$RESPONSE" ]]; then
  RUNNING_VERSION=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('version','unknown'))" 2>/dev/null || echo "unknown")
  success "ZippyMesh is running — version: $RUNNING_VERSION"
  [[ "$RUNNING_VERSION" != "$NEW_VERSION" ]] && warn "Expected $NEW_VERSION but got $RUNNING_VERSION — service may need a moment to start"
else
  warn "Service not responding yet on port $PORT. Check: systemctl --user status zippy-mesh.service"
fi

echo ""
echo -e "${GREEN}Upgrade complete!${NC}"
echo -e "  From : $CURRENT_VERSION"
echo -e "  To   : $NEW_VERSION"
echo -e "  Data : ~/.zippymesh (untouched)"
echo -e "  Logs : tail -f /tmp/zippy-mesh.log"
