export * as OpenCodeModelTools from "./model-tools.js"

import { NodeFileSystem } from "@effect/platform-node-shared"
import type { ToolEditor } from "@opencode/plugin/effect/tool"
import type { EnvironmentConnections } from "@ren/brain/environment/connections"
import { Tool } from "@opencode/schema/tool"
import type { ModelTypes } from "@ren/schema/model-types"
import { Session } from "@ren/schema/session"
import { Effect, Layer, Option, Ref, Schema, Struct } from "effect"
import { FetchHttpClient } from "effect/http"
import { basename } from "node:path"
import { Decisions } from "../../decisions.js"
import { ImageGeneration } from "../../image-generation.js"
import { Images } from "../../images.js"
import { Transcription } from "../../transcription.js"
import { WorkspaceFiles } from "../../workspace-files.js"
import { ModelRefresh } from "../../model-refresh.js"
import type { HarnessConfig } from "../config.js"
import type { Harness } from "../harness.js"

export interface Input {
  readonly current: Ref.Ref<HarnessConfig.Snapshot>
  readonly sessionId: string
  readonly directory: string
  readonly connections: Option.Option<EnvironmentConnections.Interface>
  readonly keyFor: Harness.Refresh
  readonly headers: (call: {
    readonly sessionID: string
    readonly agent: string
  }) => Effect.Effect<Record<string, string>>
}

const model = Schema.optionalKey(
  Schema.NonEmptyString.annotate({
    description: "A model ID from the configured provider. Omit to use the executing agent’s default.",
  }),
)
const TranscribeInput = Transcription.Parameters.mapFields((fields) => ({
  ...fields,
  model,
  file: Schema.NonEmptyString.annotate({ description: "Workspace path of the audio file to transcribe." }),
}))
const DecideInput = Decisions.Parameters.mapFields((fields) => ({ ...fields, model }))

const configured = (snapshot: HarnessConfig.Snapshot, type: ModelTypes.Type) => {
  const provider = snapshot.modelProviders[type]
  const catalog = snapshot.modelCatalogs[type]
  return provider && catalog?.providerId === provider.id ? { provider, catalog } : undefined
}

export const available = (snapshot: HarnessConfig.Snapshot, sessionId: string, type: ModelTypes.Type) => {
  const config = configured(snapshot, type)
  const chat = snapshot.chats.get(sessionId)
  return Boolean(
    config &&
    chat &&
    [chat.resolved.primary, ...chat.resolved.subagents].some((agent) => {
      const selected = agent.defaultModels?.[type]
      return (
        selected?.providerId === config.provider.id &&
        config.catalog.models.some((model) => model.id === selected.modelId)
      )
    }),
  )
}

export const select = Effect.fn("OpenCodeModelTools.select")(function* (
  input: Pick<Input, "current" | "sessionId" | "keyFor">,
  type: ModelTypes.Type,
  agentName: string | undefined,
  override?: string,
) {
  const current = yield* Ref.get(input.current)
  const chat = current.chats.get(input.sessionId)
  const agent =
    chat &&
    [chat.resolved.primary, ...chat.resolved.subagents].find(
      (agent) => agent.name === (agentName ?? chat.resolved.primary.name),
    )
  const selected = agent?.defaultModels?.[type]
  const config = configured(current, type)
  if (!agent || !selected || !config || selected.providerId !== config.provider.id)
    return yield* new Tool.Error({ message: `No ${type} provider and default model are configured for this agent.` })
  const modelId = override ?? selected.modelId
  const model = config.catalog.models.find((model) => model.id === modelId)
  if (!model) return yield* new Tool.Error({ message: `Unknown ${type} model: ${modelId}` })
  return {
    agent: agent.name,
    provider: config.provider,
    model: model.upstreamId ?? model.id,
    key: ModelRefresh.forProvider(config.provider, input.keyFor),
  }
})

export const register = (editor: ToolEditor, input: Input) => {
  const snapshot = Ref.getUnsafe(input.current)
  const files = Layer.provide(
    Option.match(input.connections, {
      onNone: () => WorkspaceFiles.layerLocal(input.directory),
      onSome: (connections) => WorkspaceFiles.layerEnvironment(connections, Session.ID.make(input.sessionId)),
    }),
    NodeFileSystem.layer,
  )
  const models = (type: ModelTypes.Type) => snapshot.modelCatalogs[type]?.models.map((model) => model.id).join(", ")
  if (available(snapshot, input.sessionId, "image_generation"))
    editor.add({
      name: "image_generation",
      description: `Generate images, or edit the supplied workspace images. Results are saved to workspace files. Without a model argument, use the agent’s configured image model. Available models: ${models("image_generation")}.`,
      input: ImageGeneration.Input,
      output: ImageGeneration.Output,
      options: { codemode: true },
      execute: (args, context) =>
        Effect.gen(function* () {
          const selected = yield* select(input, "image_generation", context.agent, args.model)
          return {
            output: yield* ImageGeneration.run({ ...args, model: selected.model }, yield* input.headers(context)).pipe(
              Effect.provide(Layer.mergeAll(Images.layerRen(selected.provider, selected.key), files)),
            ),
          }
        }).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.scoped,
          Effect.mapError((error) => new Tool.Error({ message: error.message, error })),
        ),
    })
  if (available(snapshot, input.sessionId, "audio_transcription"))
    editor.add({
      name: "audio_transcription",
      description: `Transcribe a workspace audio file using the executing agent’s configured transcription model. Available models: ${models("audio_transcription")}.`,
      input: TranscribeInput,
      output: Transcription.Output,
      options: { codemode: true },
      execute: (args, context) =>
        Effect.gen(function* () {
          const selected = yield* select(input, "audio_transcription", context.agent, args.model)
          return {
            output: yield* Effect.gen(function* () {
              const workspace = yield* WorkspaceFiles.Service
              return yield* Transcription.transcribe(selected.provider, selected.key, {
                ...Struct.omit(args, ["file", "model"]),
                model: selected.model,
                file: new File([yield* workspace.read(args.file)], basename(args.file)),
                headers: yield* input.headers(context),
              })
            }).pipe(Effect.provide(files)),
          }
        }).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.scoped,
          Effect.mapError((error) => new Tool.Error({ message: error.message, error })),
        ),
    })
  if (available(snapshot, input.sessionId, "decisions"))
    editor.add({
      name: "decisions",
      description: `Answer named predicate, choice, or score questions about input using the executing agent’s configured decision model. Refusals are returned per question. Available models: ${models("decisions")}.`,
      input: DecideInput,
      output: Decisions.Output,
      options: { codemode: true },
      execute: (args, context) =>
        Effect.gen(function* () {
          const selected = yield* select(input, "decisions", context.agent, args.model)
          return {
            output: yield* Decisions.decide(selected.provider, selected.key, {
              ...args,
              model: selected.model,
              headers: yield* input.headers(context),
            }),
          }
        }).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.mapError((error) => new Tool.Error({ message: error.message, error })),
        ),
    })
}
