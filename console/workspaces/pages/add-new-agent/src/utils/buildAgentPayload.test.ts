import { describe, it, expect } from "vitest";
import { buildModelConfig, findLowestEnvironmentName } from "./buildAgentPayload";
import type { LLMProviderFormEntry } from "../form/schema";

function entry(over: Partial<LLMProviderFormEntry> = {}): LLMProviderFormEntry {
  return {
    selectedProviderByEnv: { Development: { uuid: "u1", handle: "openai" } },
    urlVarName: undefined,
    apikeyVarName: undefined,
    guardrails: [],
    ...over,
  };
}

describe("buildModelConfig (flat shape)", () => {
  it("maps a single provider with no env overrides", () => {
    const out = buildModelConfig([entry()], "Development");
    expect(out).toEqual([{ providerName: "openai" }]);
  });

  it("uses the provider selected for the lowest environment", () => {
    const out = buildModelConfig([
      entry({
        selectedProviderByEnv: {
          Production: { uuid: "u2", handle: "anthropic" },
          Development: { uuid: "u1", handle: "openai" },
        },
      }),
    ], "Development");

    expect(out).toEqual([{ providerName: "openai" }]);
  });

  it("includes env-var name overrides", () => {
    const out = buildModelConfig([entry({ urlVarName: "MY_URL", apikeyVarName: "MY_KEY" })], "Development");
    expect(out?.[0]).toMatchObject({
      providerName: "openai",
      environmentVariables: [
        { key: "url", name: "MY_URL" },
        { key: "apikey", name: "MY_KEY" },
      ],
    });
  });

  it("preserves guardrail policies in configuration", () => {
    const out = buildModelConfig([entry({
      guardrails: [{ name: "pii", version: "v1", settings: { mode: "block" } }],
    })], "Development");
    expect(out?.[0].configuration?.policies).toEqual([
      { name: "pii", version: "v1", paths: [{ path: "/*", methods: ["*"], params: { mode: "block" } }] },
    ]);
  });

  it("returns undefined when no providers", () => {
    expect(buildModelConfig([], "Development")).toBeUndefined();
  });

  it("returns undefined when no provider is selected for the lowest environment", () => {
    expect(buildModelConfig([entry()], "Production")).toBeUndefined();
  });
});

describe("findLowestEnvironmentName", () => {
  it("returns the source environment that is not a promotion target", () => {
    expect(findLowestEnvironmentName([
      { sourceEnvironmentRef: "Development", targetEnvironmentRefs: [{ name: "Staging" }] },
      { sourceEnvironmentRef: "Staging", targetEnvironmentRefs: [{ name: "Production" }] },
    ])).toBe("Development");
  });

  it("returns undefined when no lowest environment can be resolved", () => {
    expect(findLowestEnvironmentName([])).toBeUndefined();
  });
});
