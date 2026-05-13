# `src/lib/routing/`

Routing engine for the ZippyMesh LLM Router. Decides which provider/model
serves a given request, including local providers (Ollama, LM Studio) and
remote mesh peers.

## Files

- `engine.js` — the active routing engine (playbooks, intent inference,
  failover scoring). This is what runs in production today.
- `smartRouter.js` — model-selection scorer used by the engine.
- `failoverManager.js` — fallback chain construction.
- `intentDetector.js` — NLP-based intent inference.
- `queueManager.js`, `rateLimiter.js`, `sessionContext.js` — supporting infra.
- `meshLimits.js` — **consumer-side mesh rate-limit filter** (FEE_MODEL.md
  spec, "Consumer-side rate limits"). Pure helper, see below.

## Mesh limits filter (`meshLimits.js`)

Implements the consumer-side rate-limit policy from
`zippycoin-core/docs/spec/FEE_MODEL.md`:

```js
import { applyMeshLimits } from "@/lib/routing/meshLimits";

const { acceptable, rejected, allow_local_fallback } = applyMeshLimits(
  candidateRoutes,
  userMeshLimits, // pulled from user settings via /api/settings
);
```

`candidateRoutes` is shaped:

```js
{
  provider: "p2p:peerXYZ",          // optional, for display
  rate_per_1k_tokens_zat: 1200,     // provider's per-1k-token price
  total_routing_fee_zat: 50_000,    // sum of hop fees
  operational_trust: 78,            // trust score 0-100
}
```

The helper is **pure** — no I/O, no DB. It is currently used by:

1. The Mesh Routing Limits settings UI (live cost preview / "what would be
   rejected" preview).

### TODO — wire into the active route picker

The active route picker (`engine.js#defaultStrategy` and the candidate
selection paths it calls) does **not** yet consume `applyMeshLimits`. Today
the engine has no concept of `rate_per_1k_tokens_zat` or
`total_routing_fee_zat` on candidates — those fields enter the data model
once the mesh marketplace + multi-hop routing fees are wired up
(post-T15, see PROJECT_TODO.md).

When that happens:

1. Read user limits from settings:

   ```js
   const settings = await getSettings();
   const meshLimits = {
     max_rate_per_1k_tokens_zat: settings.meshMaxRatePer1kTokensZat,
     max_routing_fee_total_zat:  settings.meshMaxRoutingFeeTotalZat,
     preferred_trust_floor:      settings.meshPreferredTrustFloor,
     allow_local_fallback:       settings.meshAllowLocalFallback,
   };
   ```

2. After candidate enumeration but before scoring, call:

   ```js
   const { acceptable, rejected, allow_local_fallback } =
     applyMeshLimits(candidates, meshLimits);
   ```

3. If `acceptable.length === 0`:
   - if `allow_local_fallback`, fall back to local-only candidates.
   - else, surface a "no acceptable routes" error to the caller listing
     `rejected[*].reasons`.

4. Otherwise, pass `acceptable` into the existing scorer.

The relevant insertion point is around `engine.js`'s candidate-list
construction (where `cand.connection.peer_id ?? cand.connection.meshPeerId`
is checked for trust scoring). Search for `getTrustScore(peerId)` to locate.
