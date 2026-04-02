import { encode } from 'gpt-tokenizer';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * POST /v1/messages/count_tokens - Standard OpenAI Token count response
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  // Estimate token count based on content string
  const messages = body.messages || [];
  let combinedText = "";
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      combinedText += msg.content + "\n";
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          combinedText += part.text + "\n";
        }
      }
    }
  }

  // Perform true BPE token encoding
  const tokens = encode(combinedText);
  const inputTokens = tokens.length;

  return new Response(JSON.stringify({
    input_tokens: inputTokens
  }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

