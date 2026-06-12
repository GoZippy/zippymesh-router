# Mesh Response Verification (T11)

When ZippyMesh routes a request to a peer over the P2P mesh, the peer's
sidecar signs the response body with its Ed25519 identity key. The router
verifies that signature on receipt and surfaces the verdict to the UI as a
small badge next to the assistant response.

## What the badge means

| Badge          | Header value | Meaning                                                                                                                        | What you should do                                                                                                          |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Verified       | `valid`      | The response was signed by the mesh peer and the signature matches `SHA256(request_body \|\| nonce \|\| response_body)`.       | Nothing — the response is intact.                                                                                           |
| TAMPERED       | `invalid`    | A signature was present but did not verify. Something modified the response between the peer and you.                          | **Do not trust the response.** Treat it as adversarial output. Consider reporting the peer ID via your node's trust store.  |
| Unsigned       | `missing`    | No `X-Zippy-Signature` header was on the response. Almost always means the response came from a local provider, not the mesh. | Normal for local providers (Kilo, OpenRouter, Ollama, etc.). For a mesh request this would be unexpected — check peer logs. |
| Verify error   | `error`      | Verification machinery failed (malformed pubkey, missing nonce, internal exception, etc.). Hover the badge for the reason.    | Retry the request. If it persists, the peer or sidecar is misbehaving — file an issue with the reason text.                |

## Where the verdict comes from

1. The Rust sidecar (`sidecar/src/main.rs::proxy_chat`) signs the response
   bytes plus the request-supplied nonce with its Ed25519 key.
2. `src/lib/sidecar.js::proxyChatCompletion` buffers the response, calls
   `verifyMeshResponse` from `src/lib/meshVerify.js`, and stamps the verdict
   onto two response headers:
   - `X-Zippy-Signature-Status`: `valid` | `invalid` | `missing` | `error`
   - `X-Zippy-Signature-Reason` (optional, free text)
3. `src/app/api/v1/chat/completions/route.js` passes those headers through
   to the client unchanged.
4. The client UI reads the headers and renders
   `<MeshSignatureBadge status={…} reason={…} />`.

## Reporting a tampered response

If you see **TAMPERED**, the request reached a hostile or buggy peer. The
specific peer ID is in the sidecar logs at the time of the request
(`[MeshVerify] invalid: …`). Capture the peer ID, the request body, and
the reason string from the badge tooltip, then either:

- Mark the peer as untrusted in your local trust store
  (`Dashboard → Vault Keys → trusted peers`), or
- File an issue at https://github.com/ZippyCoin/ZippyMesh_LLM_Router with
  the captured details so the peer can be flagged ecosystem-wide.

Verification is non-fatal by design: the router does NOT reject invalid
responses automatically — it surfaces the verdict and lets you (or your
agent / orchestrator) decide what to do. If you want hard rejection, gate
on the header in your client code.
