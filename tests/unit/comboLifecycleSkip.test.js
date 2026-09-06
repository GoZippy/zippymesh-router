/**
 * Regression test: handleComboChat() must not blind-try a model the
 * model_registry already knows is missing/deprecated — it should skip
 * straight to the next model in the combo instead of burning a full
 * failing round-trip through handleSingleModel().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetRegistryModel = vi.fn();
vi.mock("@/lib/modelRegistry.js", () => ({
  getRegistryModel: (...a) => mockGetRegistryModel(...a),
}));

import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function okResponse() {
  return { ok: true, status: 200, headers: { get: () => null } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleComboChat — model_registry lifecycle skip", () => {
  it("skips a deprecated model without calling handleSingleModel for it", async () => {
    mockGetRegistryModel.mockImplementation(async (provider, model) => {
      if (`${provider}/${model}` === "openai/gpt-3.5-old") return { lifecycleState: "deprecated" };
      return { lifecycleState: "active" };
    });
    const handleSingleModel = vi.fn().mockResolvedValue(okResponse());

    const result = await handleComboChat({
      body: {},
      models: ["openai/gpt-3.5-old", "anthropic/claude-sonnet"],
      handleSingleModel,
      log,
    });

    expect(result.ok).toBe(true);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel).toHaveBeenCalledWith({}, "anthropic/claude-sonnet");
  });

  it("skips a missing model the same way as deprecated", async () => {
    mockGetRegistryModel.mockImplementation(async (provider, model) => {
      if (`${provider}/${model}` === "provider/gone-model") return { lifecycleState: "missing" };
      return { lifecycleState: "active" };
    });
    const handleSingleModel = vi.fn().mockResolvedValue(okResponse());

    await handleComboChat({
      body: {},
      models: ["provider/gone-model", "provider/other-model"],
      handleSingleModel,
      log,
    });

    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel).toHaveBeenCalledWith({}, "provider/other-model");
  });

  it("still tries a model normally when the registry has no entry for it (fail open)", async () => {
    mockGetRegistryModel.mockResolvedValue(null);
    const handleSingleModel = vi.fn().mockResolvedValue(okResponse());

    await handleComboChat({
      body: {},
      models: ["provider/unregistered-model"],
      handleSingleModel,
      log,
    });

    expect(handleSingleModel).toHaveBeenCalledWith({}, "provider/unregistered-model");
  });

  it("still tries a model normally when the registry lookup throws (fail open)", async () => {
    mockGetRegistryModel.mockRejectedValue(new Error("db unavailable"));
    const handleSingleModel = vi.fn().mockResolvedValue(okResponse());

    await handleComboChat({
      body: {},
      models: ["provider/some-model"],
      handleSingleModel,
      log,
    });

    expect(handleSingleModel).toHaveBeenCalledWith({}, "provider/some-model");
  });

  it("returns a clear error when every model in the combo is stale", async () => {
    mockGetRegistryModel.mockResolvedValue({ lifecycleState: "deprecated" });
    const handleSingleModel = vi.fn();

    const result = await handleComboChat({
      body: {},
      models: ["provider/dead-a", "provider/dead-b"],
      handleSingleModel,
      log,
    });

    expect(handleSingleModel).not.toHaveBeenCalled();
    expect(result.ok).toBeFalsy();
    const payload = await result.json();
    const message = payload?.error?.message || payload?.error || "";
    expect(message).toContain("dead-b");
  });
});
