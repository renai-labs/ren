export * as OpenCodeImages from "./image-tool.js"

import { NodeFileSystem } from "@effect/platform-node-shared"
import type { ToolEditor } from "@opencode/plugin/effect/tool"
import { Tool } from "@opencode/schema/tool"
import type { EnvironmentConnections } from "@ren/brain/environment/connections"
import { Session } from "@ren/schema/session"
import { Effect, Layer, Option, Ref } from "effect"
import { FetchHttpClient } from "effect/http"
import { ImageGeneration } from "../../image-generation.js"
import { Images } from "../../images.js"
import { ModelRefresh } from "../../model-refresh.js"
import { WorkspaceFiles } from "../../workspace-files.js"
import type { HarnessConfig } from "../config.js"
import type { Harness } from "../harness.js"

export const register = (
  editor: ToolEditor,
  snapshot: HarnessConfig.Snapshot,
  input: {
    readonly current: Ref.Ref<HarnessConfig.Snapshot>
    readonly sessionId: string
    readonly directory: string
    readonly connections: Option.Option<EnvironmentConnections.Interface>
    readonly keyFor: Harness.Refresh
    readonly headers: (context: Tool.Context) => Effect.Effect<Record<string, string>>
  },
) => {
  const catalog = snapshot.modelCatalogs.image_generation
  const provider = snapshot.modelProviders.image_generation
  const chat = snapshot.chats.get(input.sessionId)
  if (!catalog?.models.length || !provider || !chat) return
  if (
    ![chat.resolved.primary, ...chat.resolved.subagents].some(
      (agent) => agent.defaultModels?.image_generation?.providerId === provider.id,
    )
  )
    return
  editor.add({
    name: "image_generation",
    description: `Generate images, or edit the supplied workspace images. Results are saved to workspace files. Without a model argument, use the agent’s configured image model. Available models: ${catalog.models.map((model) => model.id).join(", ")}.`,
    input: ImageGeneration.Input,
    output: ImageGeneration.Output,
    options: { codemode: true },
    execute: (args, context) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(input.current)
        const chat = current.chats.get(input.sessionId)
        const agent =
          chat && [chat.resolved.primary, ...chat.resolved.subagents].find((agent) => agent.name === context.agent)
        const defaultModel = agent?.defaultModels?.image_generation
        const catalog = current.modelCatalogs.image_generation
        const provider = current.modelProviders.image_generation
        if (!defaultModel || !catalog || !provider || provider.id !== catalog.providerId)
          return yield* new Tool.Error({
            message: "No image provider and default model are configured for this agent.",
          })
        const prepared = yield* Effect.fromResult(ImageGeneration.prepare(args, { catalog, defaultModel }))
        const headers = yield* input.headers(context)
        return {
          output: yield* ImageGeneration.run(prepared, headers).pipe(
            Effect.provide(
              Layer.mergeAll(
                Images.layerRen(provider, ModelRefresh.forProvider(provider, input.keyFor)),
                Option.match(input.connections, {
                  onNone: () => WorkspaceFiles.layerLocal(input.directory),
                  onSome: (connections) =>
                    WorkspaceFiles.layerEnvironment(connections, Session.ID.make(input.sessionId)),
                }),
              ),
            ),
          ),
        }
      }).pipe(
        Effect.provide(Layer.mergeAll(FetchHttpClient.layer, NodeFileSystem.layer)),
        Effect.scoped,
        Effect.mapError((error) => new Tool.Error({ message: error.message, error })),
      ),
  })
}
