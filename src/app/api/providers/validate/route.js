import { NextResponse } from "next/server";
import { getProviderNodeById } from "@/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

// POST /api/providers/validate - Validate API key with provider
export async function POST(request) {
  try {
    const body = await request.json();
    const { provider, apiKey } = body;
    const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : apiKey;

    if (!provider || !normalizedApiKey) {
      return NextResponse.json({ error: "Provider and API key required" }, { status: 400 });
    }

    let isValid = false;
    let error = null;

    // Validate with each provider
    try {
      if (isOpenAICompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
        }
        const modelsUrl = `${node.baseUrl?.replace(/\/$/, "")}/models`;
        const res = await fetch(modelsUrl, {
          headers: { "Authorization": `Bearer ${normalizedApiKey}` },
        });
        isValid = res.ok;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      if (isAnthropicCompatibleProvider(provider)) {
        const node = await getProviderNodeById(provider);
        if (!node) {
          return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
        }
        
        let normalizedBase = node.baseUrl?.trim().replace(/\/$/, "") || "";
        if (normalizedBase.endsWith("/messages")) {
          normalizedBase = normalizedBase.slice(0, -9); // remove /messages
        }
        
        const modelsUrl = `${normalizedBase}/models`;
        
        const res = await fetch(modelsUrl, {
          headers: { 
            "x-api-key": normalizedApiKey,
            "anthropic-version": "2023-06-01",
            "Authorization": `Bearer ${normalizedApiKey}` 
          },
        });
        
        isValid = res.ok;
        return NextResponse.json({
          valid: isValid,
          error: isValid ? null : "Invalid API key",
        });
      }

      switch (provider) {
        case "openai":
          const openaiRes = await fetch("https://api.openai.com/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = openaiRes.ok;
          break;

        case "anthropic":
          const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": normalizedApiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-3-haiku-20240307",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = anthropicRes.status !== 401;
          break;

        case "gemini":
          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${normalizedApiKey}`);
          isValid = geminiRes.ok;
          break;

        case "openrouter":
          const openrouterRes = await fetch("https://openrouter.ai/api/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = openrouterRes.ok;
          break;

        case "groq":
          const groqRes = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = groqRes.ok;
          break;

        case "mistral":
          const mistralRes = await fetch("https://api.mistral.ai/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = mistralRes.ok;
          break;

        case "xai":
          const xaiRes = await fetch("https://api.x.ai/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = xaiRes.ok;
          break;

        case "deepseek":
          const deepseekRes = await fetch("https://api.deepseek.com/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = deepseekRes.ok;
          break;

        case "cerebras":
          const cerebrasRes = await fetch("https://api.cerebras.ai/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = cerebrasRes.ok;
          break;

        case "cohere":
          const cohereRes = await fetch("https://api.cohere.com/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = cohereRes.ok;
          break;

        case "togetherai":
          const togetherRes = await fetch("https://api.together.xyz/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = togetherRes.ok;
          break;

        case "fireworks":
          const fireworksRes = await fetch("https://api.fireworks.ai/inference/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = fireworksRes.ok;
          break;

        case "anyscale":
          const anyscaleRes = await fetch("https://api.endpoints.anyscale.com/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = anyscaleRes.ok;
          break;

        case "perplexity":
          const perplexityRes = await fetch("https://api.perplexity.ai/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = perplexityRes.ok;
          break;

        case "deepinfra":
          const deepinfraRes = await fetch("https://api.deepinfra.com/v1/openai/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = deepinfraRes.ok;
          break;

        case "novita":
          const novitaRes = await fetch("https://api.novita.ai/v3/openai/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = novitaRes.ok;
          break;

        case "ai21":
          const ai21Res = await fetch("https://api.ai21.com/studio/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = ai21Res.ok;
          break;

        case "moonshot":
          const moonshotRes = await fetch("https://api.moonshot.ai/v1/models", {
            headers: { "Authorization": `Bearer ${normalizedApiKey}` },
          });
          isValid = moonshotRes.ok;
          break;

        case "kilo": {
          // Kilo /models endpoint is public; validate against chat endpoint auth instead
          const kiloRes = await fetch("https://api.kilo.ai/api/gateway/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${normalizedApiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "kilo/auto",
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1,
              stream: false,
            }),
          });
          // 401 is invalid key; other non-2xx can still indicate valid auth (quota/policy/rate limits)
          isValid = kiloRes.status !== 401;
          break;
        }

        case "glm":
        case "kimi":
        case "minimax":
        case "minimax-cn": {
          const claudeBaseUrls = {
            glm: "https://api.z.ai/api/anthropic/v1/messages",
            kimi: "https://api.kimi.com/coding/v1/messages",
            minimax: "https://api.minimax.io/anthropic/v1/messages",
            "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages",
          };
          const claudeRes = await fetch(claudeBaseUrls[provider], {
            method: "POST",
            headers: {
              "x-api-key": normalizedApiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          isValid = claudeRes.status !== 401;
          break;
        }

          default:
            return NextResponse.json({ error: "Provider validation not supported" }, { status: 400 });
      }
    } catch (err) {
      error = err.message;
      isValid = false;
    }

    return NextResponse.json({
      valid: isValid,
      error: isValid ? null : (error || "Invalid API key"),
    });
  } catch (error) {
    console.log("Error validating API key:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
