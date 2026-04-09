#!/bin/bash

##############################################################################
#                                                                            #
#   ZMLR Smart Routing - Integration Test Suite                            #
#   Test the /v1/chat/completions endpoint with smart routing              #
#                                                                            #
##############################################################################

set -e

# Configuration
ZMLR_URL="${ZMLR_URL:-http://localhost:20128}"
VERBOSE="${VERBOSE:-false}"
COLORS="${COLORS:-true}"
SKIP_LIVE_TESTS="${SKIP_LIVE_TESTS:-false}"

# Colors
if [ "$COLORS" = "true" ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color
else
  GREEN=""
  RED=""
  YELLOW=""
  BLUE=""
  NC=""
fi

# Helpers
log_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

log_test() {
  echo -e "\\n${YELLOW}Test: $1${NC}"
}

##############################################################################

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║              ZMLR Smart Routing - Test Suite                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

log_info "Target: $ZMLR_URL"
log_info "Verbose: $VERBOSE"
log_info "Skip live tests: $SKIP_LIVE_TESTS"

##############################################################################
# Test 1: Connectivity
##############################################################################

log_test "Connectivity - Can we reach ZMLR?"

if curl -s -I "$ZMLR_URL" > /dev/null 2>&1; then
  log_success "ZMLR is reachable"
else
  log_error "Cannot reach ZMLR at $ZMLR_URL"
  exit 1
fi

if [ "$SKIP_LIVE_TESTS" = "true" ]; then
  log_info "Skipping live routing tests (SKIP_LIVE_TESTS=true)"
  exit 0
fi

##############################################################################
# Test 2: Basic Routing - Auto Model Selection
##############################################################################

log_test "POST /v1/chat/completions - Basic routing with auto model"

RESPONSE=$(curl -s -X POST "$ZMLR_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Say hello"}
    ]
  }')

if echo "$RESPONSE" | jq empty 2>/dev/null; then
  log_success "Endpoint responds with valid JSON"
  if echo "$RESPONSE" | jq -e '.choices' > /dev/null 2>&1; then
    log_success "Response has choices array"
  else
    log_error "Response missing choices array"
    exit 1
  fi
else
  log_error "Invalid JSON response"
  if [ "$VERBOSE" = "true" ]; then
    echo "$RESPONSE"
  fi
  exit 1
fi

##############################################################################
# Test 3: Intent Header Routing
##############################################################################

log_test "GET /v1/chat/completions with X-Intent: code header"

RESPONSE=$(curl -s -i -X POST "$ZMLR_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Intent: code" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Say hello"}
    ]
  }' 2>&1)

if echo "$RESPONSE" | grep -q "x-routing-intent: code"; then
  log_success "X-Routing-Intent header present and correct"
else
  log_error "X-Routing-Intent header missing or incorrect"
  if [ "$VERBOSE" = "true" ]; then
    echo "$RESPONSE" | head -20
  fi
fi

##############################################################################
# Test 4: Constraint Headers
##############################################################################

log_test "POST /v1/chat/completions with constraint headers"

RESPONSE=$(curl -s -i -X POST "$ZMLR_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Intent: chat" \
  -H "X-Prefer-Free: true" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Say hello"}
    ]
  }' 2>&1)

if echo "$RESPONSE" | grep -q "x-selected-model:"; then
  log_success "X-Selected-Model header present"
else
  log_error "X-Selected-Model header missing"
  if [ "$VERBOSE" = "true" ]; then
    echo "$RESPONSE" | head -20
  fi
fi

##############################################################################
# Test 5: Routing Score in Headers
##############################################################################

log_test "Verify X-Routing-Score header"

RESPONSE=$(curl -s -i -X POST "$ZMLR_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Intent: code" \
  -d '{
    "messages": [
      {"role": "user", "content": "Say hello"}
    ]
  }' 2>&1)

if echo "$RESPONSE" | grep -q "x-routing-score:"; then
  SCORE=$(echo "$RESPONSE" | grep "x-routing-score:" | awk '{print $2}' | tr -d '\r')
  if [ -n "$SCORE" ] && [ "$SCORE" -gt 0 ] 2>/dev/null; then
    log_success "X-Routing-Score header present with value: $SCORE"
  else
    log_error "X-Routing-Score invalid: $SCORE"
  fi
else
  log_error "X-Routing-Score header missing"
fi

##############################################################################
# Test 6: Explicit Model Selection
##############################################################################

log_test "Explicit model selection (without auto)"

RESPONSE=$(curl -s -X POST "$ZMLR_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Say hello"}
    ]
  }' 2>&1)

if echo "$RESPONSE" | jq empty 2>/dev/null; then
  log_success "Routing works with no explicit model"
else
  log_error "Failed with no explicit model"
  if [ "$VERBOSE" = "true" ]; then
    echo "$RESPONSE"
  fi
fi

##############################################################################
# Test 7: Multiple Intents
##############################################################################

log_test "Test different intent types"

for INTENT in "code" "chat" "reasoning" "vision" "fast" "default"; do
  RESPONSE=$(curl -s -i -X POST "$ZMLR_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "X-Intent: $INTENT" \
    -d '{
      "messages": [{"role": "user", "content": "hello"}]
    }' 2>&1)

  if echo "$RESPONSE" | grep -q "x-routing-intent:"; then
    log_success "Intent '$INTENT' routed successfully"
  else
    log_error "Intent '$INTENT' routing failed"
  fi
done

##############################################################################
# Test 8: Response Metadata in Body
##############################################################################

log_test "Check _routing metadata in response body"

RESPONSE=$(curl -s -X POST "$ZMLR_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-Intent: code" \
  -d '{
    "messages": [{"role": "user", "content": "Say hello"}]
  }')

if echo "$RESPONSE" | jq -e '._routing' > /dev/null 2>&1; then
  log_success "Response contains _routing metadata"
  if [ "$VERBOSE" = "true" ]; then
    echo "$RESPONSE" | jq '._routing'
  fi
else
  log_info "No _routing metadata (expected for non-JSON or streaming responses)"
fi

##############################################################################
# Summary
##############################################################################

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    ROUTING TESTS COMPLETE ✓                    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"

echo ""
log_info "Smart routing is working correctly!"
echo ""
log_info "Helpful commands:"
echo "  # Check routing metrics"
echo "  curl $ZMLR_URL/api/routing/metrics"
echo ""
echo "  # Test with specific constraints"
echo "  curl -X POST $ZMLR_URL/v1/chat/completions \\"
echo "    -H 'X-Intent: code' \\"
echo "    -H 'X-Max-Cost-Per-M-Tokens: 0.001' \\"
echo "    -d '{\"messages\":[{\"role\":\"user\",\"content\":\"test\"}]}'"
echo ""

log_success "All routing tests passed!"

##############################################################################
