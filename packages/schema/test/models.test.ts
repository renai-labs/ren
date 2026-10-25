import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Models } from "../src/models.js"

const decode = Schema.decodeUnknownSync(Models.LiteLLMModelInfo)

const entry = (model_name: string, model_info: Record<string, unknown>) => ({ model_name, model_info })

describe("Models.fromLiteLLM", () => {
  test("groups models by provider, keeps Ren's ids and drops fallback copies", () => {
    const catalog = Models.fromLiteLLM(
      decode({
        data: [
          entry("anthropic/claude-sonnet-5-5", {
            model_key: "claude-sonnet-5-5",
            provider_key: "anthropic",
            display_name: "Claude Sonnet 5.5",
            routing: "subscription",
            max_input_tokens: 1_000_000,
            max_output_tokens: 128_000,
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
            default_variant: "medium",
            variants: [
              { id: "low", name: "Low" },
              { id: "medium", name: "Medium" },
              { id: "high", name: "High" },
            ],
          }),
          entry("anthropic/claude-sonnet-5-5-fallback", {
            model_key: "claude-sonnet-5-5-fallback",
            provider_key: "anthropic",
            routing: "openrouter-fallback",
          }),
          entry("openai/gpt-6.1-sol", { model_key: "gpt-6.1-sol", provider_key: "openai", mode: "responses" }),
          entry("z-ai/glm-5.1", {
            model_key: "glm-5.1",
            provider_key: "zhipu",
            max_input_tokens: 200_000,
            modalities: null,
          }),
          entry("no-key", { provider_key: "zhipu" }),
          entry("hidden/model", { model_key: "hidden", provider_key: "zhipu", hidden: true }),
        ],
      }),
    )
    expect(catalog).toEqual({
      endpoints: [
        {
          id: "anthropic",
          protocol: "anthropic-messages",
          models: [
            {
              id: "claude-sonnet-5-5",
              upstreamId: "anthropic/claude-sonnet-5-5",
              name: "Claude Sonnet 5.5",
              limit: { context: 1_000_000, output: 128_000 },
              input: ["text", "image", "pdf"],
              efforts: ["medium", "low", "high"],
            },
          ],
        },
        {
          id: "openai",
          protocol: "openai-responses",
          models: [{ id: "gpt-6.1-sol", upstreamId: "openai/gpt-6.1-sol", input: ["text"] }],
        },
        {
          id: "zhipu",
          protocol: "openai-chat",
          models: [
            {
              id: "glm-5.1",
              upstreamId: "z-ai/glm-5.1",
              limit: { context: 200_000, output: Models.defaultOutputLimit },
              input: ["text"],
            },
          ],
        },
      ],
    })
  })

  test("the same list in another order gives the same catalog", () => {
    const models = [
      entry("b/two", { model_key: "two", provider_key: "b" }),
      entry("a/one", { model_key: "one", provider_key: "a" }),
    ]
    expect(Models.fromLiteLLM(decode({ data: models }))).toEqual(
      Models.fromLiteLLM(decode({ data: models.toReversed() })),
    )
  })
})
