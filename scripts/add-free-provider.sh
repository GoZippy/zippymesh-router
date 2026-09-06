#!/bin/bash
# Add Free Provider to ZMLR
# Usage: ./add-free-provider.sh <provider> <api-key> [name] [priority]
# Example: ./add-free-provider.sh groq gsk_your_key_here "Groq Free" 1

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
ZMLR_URL="${ZMLR_URL:-http://localhost:20128}"
API_KEY_HEADER="${ZMLR_API_KEY:-openclaw-manual-db-injection}"

# Parse arguments
PROVIDER="${1:-}"
API_KEY="${2:-}"
NAME="${3:-}"
PRIORITY="${4:-1}"

if [ -z "$PROVIDER" ] || [ -z "$API_KEY" ]; then
    echo -e "${YELLOW}Usage: $0 <provider> <api-key> [name] [priority]${NC}"
    echo ""
    echo "Supported providers:"
    echo "  groq           - Groq Llama 3.1 70B"
    echo "  google-gemini  - Google Gemini 1.5 Flash"
    echo "  openrouter     - OpenRouter (100+ models)"
    echo ""
    echo "Examples:"
    echo "  $0 groq gsk_your_key_here"
    echo "  $0 google-gemini AIzaSy_your_key_here 'Gemini Free' 2"
    echo "  $0 openrouter sk-or-v1_your_key_here 'OpenRouter' 3"
    exit 1
fi

# Default names
if [ -z "$NAME" ]; then
    case "$PROVIDER" in
        groq)
            NAME="Groq-Free-Tier"
            ;;
        google-gemini)
            NAME="Gemini-Free-Tier"
            ;;
        openrouter)
            NAME="OpenRouter-Free"
            ;;
        *)
            NAME="$PROVIDER-Free"
            ;;
    esac
fi

# Validate ZMLR is running
echo -e "${BLUE}→ Checking ZMLR at $ZMLR_URL...${NC}"
if ! curl -s "$ZMLR_URL/api/health" > /dev/null 2>&1; then
    echo -e "${RED}✗ Cannot connect to ZMLR at $ZMLR_URL${NC}"
    exit 1
fi
echo -e "${GREEN}✓ ZMLR is running${NC}"

# Add provider
echo -e "${BLUE}→ Adding $PROVIDER provider: $NAME${NC}"

RESPONSE=$(curl -s -X POST "$ZMLR_URL/api/providers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY_HEADER" \
    -d "{
        \"provider\": \"$PROVIDER\",
        \"authType\": \"apikey\",
        \"name\": \"$NAME\",
        \"apiKey\": \"$API_KEY\",
        \"priority\": $PRIORITY,
        \"isActive\": true
    }")

if echo "$RESPONSE" | grep -q '"id"'; then
    PROVIDER_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
    echo -e "${GREEN}✓ Provider added successfully${NC}"
    echo -e "  Name: $NAME"
    echo -e "  Provider: $PROVIDER"
    echo -e "  ID: $PROVIDER_ID"
    echo -e "  Priority: $PRIORITY"
    echo ""
    echo -e "${GREEN}✓ Provider is ready to use with 'free-models-tier-1' playbook${NC}"
else
    echo -e "${RED}✗ Failed to add provider${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi

# Test provider
echo ""
echo -e "${BLUE}→ Testing provider...${NC}"
TEST_RESPONSE=$(curl -s -X POST "$ZMLR_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{
        \"model\": \"free-models-tier-1\",
        \"messages\": [{\"role\": \"user\", \"content\": \"Say 'hello'\"}],
        \"max_tokens\": 10
    }")

if echo "$TEST_RESPONSE" | grep -q '"content"'; then
    echo -e "${GREEN}✓ Provider is working!${NC}"
    # Show first 100 chars of response
    PREVIEW=$(echo "$TEST_RESPONSE" | grep -o '"content":"[^"]*' | head -1 | cut -d'"' -f4 | head -c 100)
    echo -e "  Response: $PREVIEW..."
else
    echo -e "${YELLOW}⚠ Provider may not be fully configured yet${NC}"
    echo -e "  Wait a moment and test manually:"
    echo -e "  curl -X POST http://localhost:20128/v1/chat/completions \\"
    echo -e "    -H 'Content-Type: application/json' \\"
    echo -e "    -d '{\"model\": \"free-models-tier-1\", \"messages\": [{\"role\": \"user\", \"content\": \"test\"}]}'"
fi

echo ""
echo -e "${GREEN}✓ All done! Provider is configured and ready.${NC}"
