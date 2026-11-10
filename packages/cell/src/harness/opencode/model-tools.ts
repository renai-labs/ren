export * as OpenCodeModelTools from "./model-tools.js"

import { NodeFileSystem } from "@effect/platform-node-shared"
import type { ToolEditor } from "@opencode/plugin/effect/tool"
import type { PermissionDomain } from "@opencode/plugin/effect/permission"
import type { EnvironmentConnections } from "@ren/brain/environment/connections"
import { Tool } from "@opencode/schema/tool"
import { ModelTypes } from "@ren/schema/model-types"
import { Session } from "@ren/schema/session"
import { Effect, Layer, Option, Ref, Schema, Struct } from "effect"
import { FetchHttpClient } from "effect/http"
import { basename } from "node:path"
import { Decisions } from "../../decisions.js"
import { ProviderHttp } from "../../provider-http.js"
import { Transcription } from "../../transcription.js"
import { WorkspaceFiles } from "../../workspace-files.js"
import type { HarnessConfig } from "../config.js"
import type { Harness } from "../harness.js"

export interface Input {
  readonly current: Ref.Ref<HarnessConfig.Snapshot>
  readonly sessionId: string
  readonly directory: string
  readonly connections: Option.Option<EnvironmentConnections.Interface>
  readonly keyFor: Harness.Refresh
  readonly permission: PermissionDomain
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

const available = (snapshot: HarnessConfig.Snapshot, type: ModelTypes.Type) =>
  snapshot.models.some((endpoint) => endpoint.models.some((model) => model.type === ModelTypes.modelType[type]))

const select = Effect.fn("OpenCodeModelTools.select")(function* (
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
  if (!agent) return yield* new Tool.Error({ message: "No executing agent is configured." })
  const models = current.models.flatMap((endpoint) =>
    endpoint.models.filter((model) => model.type === ModelTypes.modelType[type]).map((model) => ({ endpoint, model })),
  )
  const ref = override ?? (selected && `${selected.providerId}/${selected.modelId}`)
  const found = ref
    ? models.find(
        (item) =>
          `${item.endpoint.id}/${item.model.id}` === ref ||
          (item.endpoint.id === selected?.providerId && item.model.id === ref),
      )
    : (models.find((item) => item.endpoint.id === agent.model.endpointId) ?? models.at(0))
  if (!found) return yield* new Tool.Error({ message: `Unknown ${type} model: ${ref ?? "none available"}` })
  return {
    agent: agent.name,
    provider: found.endpoint,
    model: found.model.id,
    key: ProviderHttp.key(found.endpoint, input.keyFor),
    ref: `${found.endpoint.id}/${found.model.id}`,
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
  const models = (type: ModelTypes.Type) =>
    snapshot.models
      .flatMap((endpoint) =>
        endpoint.models
          .filter((model) => model.type === ModelTypes.modelType[type])
          .map((model) => `${endpoint.id}/${model.id}`),
      )
      .join(", ")
  if (available(snapshot, "audio_transcription"))
    editor.add({
      name: "audio_transcription",
      description: `Transcribe a workspace audio file using the executing agent’s configured transcription model. Available models: ${models("audio_transcription")}.`,
      input: TranscribeInput,
      output: Transcription.Output,
      options: { codemode: true },
      execute: (args, context) =>
        Effect.gen(function* () {
          const selected = yield* select(input, "audio_transcription", context.agent, args.model)
          yield* input.permission.assert({
            action: "audio_transcription",
            resources: [selected.ref],
            sessionID: context.sessionID,
            agent: context.agent,
          })
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
  if (available(snapshot, "decisions"))
    editor.add({
      name: "decisions",
      description: `Answer named predicate, choice, or score questions about input using the executing agent’s configured decision model. Refusals are returned per question. Available models: ${models("decisions")}.`,
      input: DecideInput,
      output: Decisions.Output,
      options: { codemode: true },
      execute: (args, context) =>
        Effect.gen(function* () {
          const selected = yield* select(input, "decisions", context.agent, args.model)
          yield* input.permission.assert({
            action: "decisions",
            resources: [selected.ref],
            sessionID: context.sessionID,
            agent: context.agent,
          })
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
