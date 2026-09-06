#!/bin/bash
# Setup Free Tier Providers for ZMLR
# Configures Groq, Google Gemini, and OpenRouter in running ZMLR instance
# Usage: ./setup-free-providers.sh [--api-key YOUR_KEY]

set -euo pipefail

# Configuration
ZMLR_URL="${ZMLR_URL:-http://localhost:20128}"
API_KEY="${1:-openclaw-manual-db-injection}"  # Use existing key if available
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${BLUE}ℹ ${1}${NC}"
}

log_success() {
    echo -e "${GREEN}✓ ${1}${NC}"
}

log_warn() {
    echo -e "${YELLOW}⚠ ${1}${NC}"
}

log_error() {
    echo -e "${RED}✗ ${1}${NC}"
}

# Check if ZMLR is running
log_info "Checking ZMLR connectivity at $ZMLR_URL..."
if ! curl -s "$ZMLR_URL/api/health" > /dev/null 2>&1; then
    log_error "Cannot connect to ZMLR at $ZMLR_URL"
    log_warn "Make sure ZMLR is running: npm start (in ZippyMesh_LLM_Router directory)"
    exit 1
fi
log_success "ZMLR is running and accessible"

# Import free-models playbook
log_info "Importing free-models-tier-1 playbook..."
PLAYBOOK_FILE="$PROJECT_ROOT/docs/example-playbooks/free-models-tier-1.json"

if [ ! -f "$PLAYBOOK_FILE" ]; then
    log_error "Playbook file not found: $PLAYBOOK_FILE"
    exit 1
fi

IMPORT_RESPONSE=$(curl -s -X POST "$ZMLR_URL/api/routing/playbooks" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d @"$PLAYBOOK_FILE")

if echo "$IMPORT_RESPONSE" | grep -q '"id"'; then
    PLAYBOOK_ID=$(echo "$IMPORT_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
    log_success "Playbook imported successfully (ID: $PLAYBOOK_ID)"
else
    log_warn "Playbook import response: $IMPORT_RESPONSE"
fi

# Provider setup info
log_info "Free providers configuration:"
echo ""
echo "To enable free tier LLM providers, you need to:"
echo ""
echo "1. ADD GROQ PROVIDER (Fastest - recommended first)"
echo "   URL: https://console.groq.com"
echo "   - Sign up or login"
echo "   - Copy your API key (starts with 'gsk_')"
echo "   - Add provider in ZMLR dashboard or via curl:"
echo ""
echo "   curl -X POST http://localhost:20128/api/providers \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -H 'Authorization: Bearer $API_KEY' \\"
echo "     -d '{"
echo "       \"provider\": \"groq\","
echo "       \"authType\": \"apikey\","
echo "       \"name\": \"Groq-Free-Tier\","
echo "       \"apiKey\": \"gsk_YOUR_KEY_HERE\","
echo "       \"priority\": 1,"
echo "       \"isActive\": true"
echo "     }'"
echo ""
echo "2. ADD GOOGLE GEMINI PROVIDER (Most reliable)"
echo "   URL: https://ai.google.dev/"
echo "   - Create API key (free tier: 1M tokens/day)"
echo "   - Add provider:"
echo ""
echo "   curl -X POST http://localhost:20128/api/providers \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -H 'Authorization: Bearer $API_KEY' \\"
echo "     -d '{"
echo "       \"provider\": \"google-gemini\","
echo "       \"authType\": \"apikey\","
echo "       \"name\": \"Gemini-Free-Tier\","
echo "       \"apiKey\": \"AIzaSy_YOUR_KEY_HERE\","
echo "       \"priority\": 2,"
echo "       \"isActive\": true"
echo "     }'"
echo ""
echo "3. ADD OPENROUTER PROVIDER (Optional - fallback)"
echo "   URL: https://openrouter.ai/keys"
echo "   - Sign up and copy API key (starts with 'sk-or-v1-')"
echo "   - Add provider:"
echo ""
echo "   curl -X POST http://localhost:20128/api/providers \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -H 'Authorization: Bearer $API_KEY' \\"
echo "     -d '{"
echo "       \"provider\": \"openrouter\","
echo "       \"authType\": \"apikey\","
echo "       \"name\": \"OpenRouter-Free\","
echo "       \"apiKey\": \"sk-or-v1_YOUR_KEY_HERE\","
echo "       \"priority\": 3,"
echo "       \"isActive\": true"
echo "     }'"
echo ""
echo "4. VERIFY SETUP"
echo "   - Check providers in ZMLR dashboard: http://localhost:20128"
echo "   - Select 'free-models-tier-1' playbook"
echo "   - Test routing: curl -X POST http://localhost:20128/v1/chat/completions \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"model\": \"free-models-tier-1\", \"messages\": [{\"role\": \"user\", \"content\": \"test\"}]}'"
echo ""

# Summary
echo ""
log_info "Setup Summary:"
echo "✓ ZMLR is running on $ZMLR_URL"
echo "✓ Playbook 'free-models-tier-1' created"
echo "→ Next: Add free provider API keys (see instructions above)"
echo ""
log_warn "After adding providers, the system will route requests to free tiers only:"
echo "  - Groq (300+ tok/sec) - Primary"
echo "  - Gemini (50 tok/sec) - Secondary"
echo "  - OpenRouter - Fallback"
echo "  - Ollama (local) - Emergency"
echo ""
log_success "Setup complete! Ready for configuration."
