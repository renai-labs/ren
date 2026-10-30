import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Models } from "../src/models.js"

const decode = Schema.decodeUnknownSync(Models.InferenceModelInfo)

const entry = (model_name: string, model_info: Record<string, unknown>) => ({ model_name, model_info })

describe("Models.fromInference", () => {
  test("groups models by provider, keeps Ren's ids, gives a model its own protocol when it differs and drops hidden models", () => {
    const catalog = Models.fromInference(
      decode({
        data: [
          entry("anthropic/claude-sonnet-5-5", {
            model_key: "claude-sonnet-5-5",
            provider_key: "anthropic",
            display_name: "Claude Sonnet 5.5",
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
            hidden: true,
          }),
          entry("openai/gpt-6.1-sol", { model_key: "gpt-6.1-sol", provider_key: "openai", mode: "responses" }),
          entry("openai/gpt-5.4-nano", { model_key: "gpt-5.4-nano", provider_key: "openai" }),
          entry("z-ai/glm-5.1", {
            model_key: "glm-5.1",
            provider_key: "zhipu",
            max_input_tokens: 200_000,
            modalities: null,
          }),
          entry("no-key", { provider_key: "zhipu" }),
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
          models: [
            { id: "gpt-5.4-nano", upstreamId: "openai/gpt-5.4-nano", input: ["text"], protocol: "openai-chat" },
            { id: "gpt-6.1-sol", upstreamId: "openai/gpt-6.1-sol", input: ["text"] },
          ],
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

  test("non-chat model types do not create chat models or chat endpoints", () => {
    const catalog = Models.fromInference(
      decode({
        data: [
          entry("openai/gpt-6.1-sol", { model_key: "gpt-6.1-sol", provider_key: "openai", mode: "responses" }),
          entry("ren/gpt-image-2.5-flare", {
            model_key: "gpt-image-2.5-flare",
            provider_key: "ren",
            display_name: "GPT Image 2.5 Flare",
            mode: "image_generation",
          }),
          ...["audio_transcription", "decisions", "audio_speech", "embedding"].map((mode) =>
            entry(`ren/${mode}`, { model_key: mode, provider_key: "ren", mode }),
          ),
        ],
      }),
    )
    expect(catalog.endpoints).toEqual([
      {
        id: "openai",
        protocol: "openai-responses",
        models: [{ id: "gpt-6.1-sol", upstreamId: "openai/gpt-6.1-sol", input: ["text"] }],
      },
    ])
  })

  test("the same list in another order gives the same catalog", () => {
    const models = [
      entry("b/two", { model_key: "two", provider_key: "b" }),
      entry("a/one", { model_key: "one", provider_key: "a" }),
    ]
    expect(Models.fromInference(decode({ data: models }))).toEqual(
      Models.fromInference(decode({ data: models.toReversed() })),
    )
  })
})
