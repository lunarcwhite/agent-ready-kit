// TASK-040 acceptance: SDK-free domain boundary, per-operation model
// config, structured output, normalized errors, timeouts, server-side keys.
// Pure unit tests — the fake performs no network or filesystem I/O.
import { describe, expect, it } from "vitest";
import { readApiKey, resolveProviderConfig } from "./config";
import { ProviderError } from "./errors";
import { FakeProvider } from "./fake";
import { getProvider, registerProvider, registeredProviders } from "./registry";

describe("resolveProviderConfig", () => {
  it("defaults to the fake provider with sane timeouts", () => {
    const config = resolveProviderConfig({});
    expect(config.provider).toBe("fake");
    expect(config.defaultModel).toBe("fake-1");
    expect(config.timeoutMs).toBe(30_000);
    expect(config.hasApiKey).toBe(false);
  });

  it("accepts per-operation configuration from the environment", () => {
    const config = resolveProviderConfig({
      AI_PROVIDER: "openai",
      AI_DEFAULT_MODEL: "gpt-4o",
      AI_TIMEOUT_MS: "5000",
      AI_API_KEY: "sk-test-1234",
    });
    expect(config.provider).toBe("openai");
    expect(config.defaultModel).toBe("gpt-4o");
    expect(config.timeoutMs).toBe(5000);
    expect(config.hasApiKey).toBe(true);
  });

  it("rejects unknown providers and bad timeouts as configuration errors", () => {
    expect(() => resolveProviderConfig({ AI_PROVIDER: "skynet" })).toThrow(ProviderError);
    expect(() => resolveProviderConfig({ AI_TIMEOUT_MS: "-5" })).toThrow(ProviderError);
    expect(() => readApiKey({})).toThrow(ProviderError);
  });

  it("never exposes the key through the config object", () => {
    const config = resolveProviderConfig({ AI_API_KEY: "sk-live-secret-value" });
    expect(JSON.stringify(config)).not.toContain("sk-live-secret-value");
  });
});

describe("FakeProvider", () => {
  it("returns scripted structured output with per-operation model selection", async () => {
    const fake = new FakeProvider([{ kind: "structured", json: '{"a":1}' }]);
    const result = await fake.generateStructured(
      { system: "s", user: "u", responseFormat: "json" },
      { model: "big-reasoner" },
    );
    expect(result.data).toEqual({ a: 1 });
    expect(result.rawText).toBe('{"a":1}');
    expect(result.model).toEqual({ provider: "fake", model: "big-reasoner" });
    expect(fake.calls[0]).toMatchObject({ method: "generateStructured", model: "big-reasoner" });
  });

  it("returns scripted text", async () => {
    const fake = new FakeProvider([{ kind: "text", text: "hello" }]);
    const result = await fake.generateText({ system: "s", user: "u" });
    expect(result.text).toBe("hello");
  });

  it("times out slow responses with a retryable error", async () => {
    const fake = new FakeProvider([
      { kind: "delay", delayMs: 200, then: { kind: "text", text: "late" } },
    ]);
    const failure = await fake
      .generateText({ system: "s", user: "u" }, { timeoutMs: 20 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).code).toBe("TIMEOUT");
    expect((failure as ProviderError).retryable).toBe(true);
  });

  it("rejects malformed JSON as non-retryable", async () => {
    const fake = new FakeProvider([{ kind: "structured", json: "not json{" }]);
    const failure = await fake
      .generateStructured({ system: "s", user: "u", responseFormat: "json" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).code).toBe("INVALID_RESPONSE");
    expect((failure as ProviderError).retryable).toBe(false);
  });

  it("surfaces rate limits as retryable and never leaks keys in messages", async () => {
    const fake = new FakeProvider([
      { kind: "fail", code: "RATE_LIMITED", message: "slow down sk-live-secret-value" },
    ]);
    const failure = await fake
      .generateText({ system: "s", user: "u" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).code).toBe("RATE_LIMITED");
    expect((failure as ProviderError).retryable).toBe(true);
    expect((failure as Error).message).not.toContain("sk-live-secret-value");
  });
});

describe("registry", () => {
  it("serves the fake by default and rejects unknown vendors", () => {
    expect(registeredProviders()).toContain("fake");
    expect(getProvider("fake").name).toBe("fake");
    expect(() => getProvider("openai")).toThrow(ProviderError);
  });

  it("accepts new adapters without changing callers", () => {
    const custom = new FakeProvider();
    registerProvider("openai", () => custom);
    expect(getProvider("openai")).toBe(custom);
  });
});
