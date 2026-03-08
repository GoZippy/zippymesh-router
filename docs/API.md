# ZippyMesh LLM Router API Documentation

This document describes the API endpoints provided by ZippyMesh LLM Router.

## Base URL

By default, the router runs at `http://localhost:20128`.

## Authentication

### Dashboard Endpoints (`/api/*`)

Dashboard endpoints may require login authentication when `requireLogin` is enabled:
- Session-based authentication via cookie after POST `/api/auth/login`

### Router Endpoints (`/v1/*`)

When `requireApiKey` is enabled in settings, all `/v1/*` endpoints require a Bearer token:

```
Authorization: Bearer <your-api-key>
```

API keys can be created and managed via the dashboard Profile page or the `/api/keys` endpoint.

---

## Chat Completions (OpenAI-Compatible)

### POST `/api/v1/chat/completions`

Standard OpenAI-compatible chat completions endpoint. Supports streaming.

**Request:**
```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1000
}
```

**Response (non-streaming):**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1709234567,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

**Streaming:** Set `"stream": true` to receive Server-Sent Events (SSE).

---

## Models

### GET `/api/v1/models`

List available models from connected providers.

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o-mini",
      "object": "model",
      "owned_by": "openai",
      "provider": "openai"
    },
    {
      "id": "claude-3-5-sonnet-20241022",
      "object": "model",
      "owned_by": "anthropic",
      "provider": "anthropic"
    }
  ]
}
```

---

## API Key Management

### GET `/api/keys`

List all router API keys.

**Response:**
```json
{
  "keys": [
    {
      "id": "uuid-xxxx",
      "name": "Cursor",
      "scopes": [],
      "createdAt": "2026-03-05T10:00:00Z",
      "expiresAt": null,
      "revoked": false
    }
  ]
}
```

### POST `/api/keys`

Create a new router API key.

**Request:**
```json
{
  "name": "My App",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

**Response:**
```json
{
  "id": "uuid-xxxx",
  "key": "the-raw-key-to-copy"
}
```

> **Important:** The raw key is only shown once. Copy it immediately.

### DELETE `/api/keys/:id`

Revoke an API key.

**Response:**
```json
{
  "success": true
}
```

---

## Provider Management

### GET `/api/providers`

List all configured provider connections.

**Response:**
```json
{
  "connections": [
    {
      "id": "uuid-xxxx",
      "provider": "openai",
      "authType": "api_key",
      "name": "Main Account",
      "isActive": true,
      "testStatus": "ok"
    }
  ]
}
```

### POST `/api/providers`

Add a new provider connection.

**Request:**
```json
{
  "provider": "openai",
  "authType": "api_key",
  "apiKey": "sk-...",
  "name": "Work Account"
}
```

### DELETE `/api/providers/:id`

Remove a provider connection.

---

## Usage & Analytics

### GET `/api/usage/history`

Get usage history with optional filters.

**Query Parameters:**
- `provider` - Filter by provider
- `model` - Filter by model
- `startDate` - ISO date string
- `endDate` - ISO date string

**Response:**
```json
{
  "history": [
    {
      "requestId": "req-xxx",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "timestamp": "2026-03-05T10:30:00Z",
      "latencyMs": 1234,
      "ourPromptTokens": 100,
      "ourCompletionTokens": 50,
      "ourExpectedCostUsd": 0.0015
    }
  ]
}
```

### GET `/api/usage/request-logs`

Get raw request logs (pipe-delimited format).

**Response:**
```json
{
  "logs": [
    "05-03-2026 10:30:00 | gpt-4o-mini | OPENAI | Main | 100 | 50 | OK"
  ],
  "isDemo": false
}
```

---

## Settings

### GET `/api/settings`

Get current settings.

### PATCH `/api/settings`

Update settings.

**Request:**
```json
{
  "requireApiKey": true,
  "fallbackStrategy": "round-robin"
}
```

---

## Health Check

### GET `/api/health`

Check if the router is running.

**Response:**
```json
{
  "status": "ok",
  "version": "0.2.0-alpha",
  "uptime": 3600
}
```

---

## Marketplace Models

### GET `/api/marketplace/models`

Get all models from the registry with pricing and latency data.

**Query Parameters:**
- `provider` - Filter by provider
- `isFree` - Filter free models only (`true`)
- `search` - Search term

**Response:**
```json
{
  "models": [
    {
      "provider": "openai",
      "modelId": "gpt-4o-mini",
      "name": "GPT-4o Mini",
      "inputPrice": 0.00015,
      "outputPrice": 0.0006,
      "avgLatency": 1250,
      "isFree": false,
      "contextWindow": 128000
    }
  ]
}
```

---

## Routing Playbooks

### GET `/api/routing/playbooks`

List all routing playbooks.

### POST `/api/routing/playbooks`

Create a new playbook.

### DELETE `/api/routing/playbooks/:id`

Delete a playbook.

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "error": "Error message here"
}
```

HTTP Status Codes:
- `400` - Bad Request
- `401` - Unauthorized
- `404` - Not Found
- `429` - Rate Limited
- `500` - Internal Server Error
