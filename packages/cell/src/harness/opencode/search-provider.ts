export * as OpenCodeSearch from "./search-provider.js"

import type { ToolEditor } from "@opencode/plugin/effect/tool"
import type { WebSearchEditor } from "@opencode/plugin/effect/websearch"
import type { Tool } from "@opencode/schema/tool"
import { Context, Effect, Predicate, Ref } from "effect"
import { FetchHttpClient } from "effect/http"
import { Search } from "../../search.js"
import { OpenCodeModelTools } from "./model-tools.js"

class Execution extends Context.Reference<Tool.Context | undefined>("@ren/cell/SearchExecution", {
  defaultValue: () => undefined,
}) {}

export const withExecution = (editor: ToolEditor) => {
  const tool = editor.list().find((tool) => tool.name === "websearch")
  if (!tool) return
  editor.update(tool.id, (tool) => {
    const execute = tool.execute
    tool.execute = (args, context) => execute(args, context).pipe(Effect.provideService(Execution, context))
  })
}

export const register = (editor: WebSearchEditor, input: OpenCodeModelTools.Input) => {
  if (!OpenCodeModelTools.available(Ref.getUnsafe(input.current), input.sessionId, "search")) return
  editor.add({
    id: "ren",
    name: "Ren",
    execute: (args) =>
      Effect.gen(function* () {
        const call = yield* Execution
        const selected = yield* OpenCodeModelTools.select(input, "search", call?.agent)
        return yield* Search.search(selected.provider, selected.key, {
          query: args.query,
          model: selected.model,
          headers: yield* input.headers({ sessionID: call?.sessionID ?? input.sessionId, agent: selected.agent }),
        })
      }).pipe(Effect.provide(FetchHttpClient.layer)),
  })
  if (Predicate.isUndefined(editor.default.get())) editor.default.set("ren")
}
