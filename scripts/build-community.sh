#!/usr/bin/env bash
# build-community.sh — Produce the ZippyMesh Community Edition
#
# 1. Reads .zippy-private for the list of proprietary paths
# 2. Copies community stubs over each proprietary source path
# 3. Strips internal config from .env.example and next.config.mjs
# 4. Builds the project to verify it compiles cleanly
# 5. Outputs community-dist/ directory

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_LIST="$REPO_ROOT/.zippy-private"
STUBS_DIR="$REPO_ROOT/stubs/community"
DIST_DIR="$REPO_ROOT/community-dist"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[community-build]${NC} $*"; }
success() { echo -e "${GREEN}[community-build]${NC} $*"; }
warn()    { echo -e "${YELLOW}[community-build] WARN:${NC} $*"; }
error()   { echo -e "${RED}[community-build] ERROR:${NC} $*" >&2; exit 1; }

# ── Preflight checks ──────────────────────────────────────────────────────────
[[ -f "$PRIVATE_LIST" ]] || error ".zippy-private not found at $REPO_ROOT"
[[ -d "$STUBS_DIR" ]]    || error "stubs/community/ directory not found"

info "Starting Community Edition build..."
info "Repo: $REPO_ROOT"
info "Stubs: $STUBS_DIR"
info "Output: $DIST_DIR"

# ── Step 1: Copy repo to community-dist ──────────────────────────────────────
info "Copying source tree to $DIST_DIR..."
rm -rf "$DIST_DIR"
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='community-dist' \
  --exclude='stubs' \
  "$REPO_ROOT/" "$DIST_DIR/"

# ── Step 2: Replace proprietary files with stubs ─────────────────────────────
REPLACED=0
MISSING_STUBS=0

while IFS= read -r path_entry || [[ -n "$path_entry" ]]; do
  # Skip blank lines and comments
  [[ -z "$path_entry" || "$path_entry" == \#* ]] && continue

  # Strip trailing slash (directory entries)
  path_clean="${path_entry%/}"
  src_path="$DIST_DIR/$path_clean"
  stub_path="$STUBS_DIR/$path_clean"

  if [[ -d "$stub_path" ]]; then
    # Directory stub — replace all files in directory
    if [[ -d "$src_path" ]]; then
      info "  Replacing directory: $path_clean"
      rm -rf "$src_path"
      mkdir -p "$src_path"
      cp -r "$stub_path/." "$src_path/"
      REPLACED=$((REPLACED + 1))
    else
      warn "  Source directory not found (skipping): $path_clean"
    fi
  elif [[ -f "$stub_path" ]]; then
    # File stub — replace single file
    if [[ -f "$src_path" ]]; then
      info "  Replacing file: $path_clean"
      cp "$stub_path" "$src_path"
      REPLACED=$((REPLACED + 1))
    else
      warn "  Source file not found (skipping): $path_clean"
    fi
  else
    warn "  No stub found for: $path_clean (expected at $stub_path)"
    MISSING_STUBS=$((MISSING_STUBS + 1))
  fi
done < "$PRIVATE_LIST"

success "Replaced $REPLACED proprietary path(s) with community stubs"
[[ $MISSING_STUBS -gt 0 ]] && warn "$MISSING_STUBS stub(s) missing — community build may be incomplete"

# ── Step 3: Strip internal config ────────────────────────────────────────────
info "Stripping internal configuration..."

# Clean .env.example — remove ZippyCoin RPC, internal node endpoints
if [[ -f "$DIST_DIR/.env.example" ]]; then
  sed -i \
    -e '/ZIPPY_CHAIN_RPC/d' \
    -e '/ZIPPY_NODE_URL/d' \
    -e '/ZIPPY_BEACON/d' \
    -e '/ZIPPYCOIN/d' \
    -e '/P2P_/d' \
    "$DIST_DIR/.env.example"
  info "  Cleaned .env.example"
fi

# Clean next.config.mjs — remove internal rewrites/redirects if present
if [[ -f "$DIST_DIR/next.config.mjs" ]]; then
  info "  next.config.mjs preserved (review manually for internal endpoints)"
fi

# Add community edition marker
cat >> "$DIST_DIR/.env.example" << 'ENVEOF'

# Community Edition
ZIPPYMESH_EDITION=community
ENVEOF

# ── Step 4: Install dependencies and build ────────────────────────────────────
info "Installing dependencies in community-dist..."
(cd "$DIST_DIR" && npm install --prefer-offline --silent) \
  || error "npm install failed in community-dist"

info "Building Next.js app..."
# JWT_SECRET must be non-empty for auth routes to compile.
# This is a build-time placeholder only — runtime uses the real secret.
export JWT_SECRET="${JWT_SECRET:-build-time-placeholder-not-used-at-runtime}"
(cd "$DIST_DIR" && npm run build:next 2>&1) \
  || error "Next.js build failed — community edition has a compilation error"

# ── Step 5: Summary ───────────────────────────────────────────────────────────
echo ""
success "Community Edition build complete!"
success "Output directory: $DIST_DIR"
echo ""
echo -e "  ${CYAN}Next steps:${NC}"
echo "  1. Test: cd community-dist && npm start"
echo "  2. Verify: curl http://localhost:20128/api/health"
echo "  3. Publish: push community-dist/ to the public 'community' branch"
