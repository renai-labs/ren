import { expect, test } from "bun:test"
import { Schema } from "effect"
import { ModelTypes } from "../src/model-types.js"
import { Models } from "../src/models.js"

test("Ren catalogs isolate model types and preserve distinct gateway routes", () => {
  const info = Schema.decodeUnknownSync(Models.InferenceModelInfo)({
    data: [
      {
        model_name: "route/image",
        model_info: { model_key: "image", provider_key: "openai", mode: "image_generation" },
      },
      {
        model_name: "other/image",
        model_info: { model_key: "image", provider_key: "other", mode: "image_generation" },
      },
      { model_name: "ren/audio", model_info: { model_key: "audio", provider_key: "ren", mode: "audio_transcription" } },
      { model_name: "ren/chat", model_info: { model_key: "chat", provider_key: "ren", mode: "chat" } },
      { model_name: "ren/video", model_info: { model_key: "video", provider_key: "ren", mode: "video_generation" } },
      {
        model_name: "ren/hidden",
        model_info: { model_key: "hidden", provider_key: "ren", mode: "decisions", hidden: true },
      },
    ],
  })
  const catalogs = ModelTypes.fromInference(info)
  expect(catalogs.image_generation).toEqual({
    providerId: "ren",
    models: [
      { id: "openai/image", upstreamId: "route/image" },
      { id: "other/image", upstreamId: "other/image" },
    ],
  })
  expect(catalogs.audio_transcription?.models).toEqual([{ id: "ren/audio", upstreamId: "ren/audio" }])
  expect(catalogs.decisions?.models).toEqual([])
  expect(catalogs.video_generation).toBeUndefined()
  expect(catalogs.search).toBeUndefined()
  expect(ModelTypes.fromInference({ data: info.data.toReversed() })).toEqual(catalogs)
})

test("search discovery retains the full name and deduplicates independently of model discovery", () => {
  expect(
    ModelTypes.fromSearch({
      data: [
        { search_tool_name: "ren/search/deep" },
        { search_tool_name: "ren/search/deep" },
        { search_tool_name: "search" },
      ],
    }),
  ).toEqual({
    providerId: "ren",
    models: [
      { id: "ren/search/deep", upstreamId: "ren/search/deep" },
      { id: "search", upstreamId: "search" },
    ],
  })
})

test("a public catalog strips provider credentials and rejects ambiguous model IDs", () => {
  const decode = Schema.decodeUnknownSync(ModelTypes.Catalog)
  expect(decode({ providerId: "ren", models: [], baseUrl: "https://example.com", apiKey: "secret" })).toEqual({
    providerId: "ren",
    models: [],
  })
  expect(() => decode({ providerId: "ren", models: [{ id: "same" }, { id: "same" }] })).toThrow()
})
