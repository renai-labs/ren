export * as OpenCodeCopies from "./copies.js"

import type { Plugin } from "@opencode/plugin/effect"
import { Tool } from "@opencode/schema/tool"
import type { EnvironmentCopies } from "@ren/brain/environment/copies"
import { Effect, Option, Semaphore } from "effect"
import { OpenCodeEnvironmentTools } from "./environment-tools.js"

export interface Item extends EnvironmentCopies.Item {
  // oxlint-disable-next-line ren/no-comments -- The line that the tool result gets when the copy fails (R38).
  readonly note: (message: string) => string
}

// oxlint-disable-next-line ren/no-comments -- R38, R44, R56: before an environment tool, the references and the loaded skills are copied; a copy that fails does not fail the tool, its cause goes into the result. Each prompt copies again.
export const make = Effect.fnUntraced(function* (input: {
  readonly context: Pick<Plugin.Context, "tool" | "session">
  readonly copies: Option.Option<EnvironmentCopies.Interface>
  readonly items: () => ReadonlyArray<Item>
}) {
  if (Option.isNone(input.copies)) return
  const copies = input.copies.value
  const notes = new Map<string, string>()
  const copying = yield* Semaphore.make(1)
  yield* input.context.session.hook("prompt", () => copies.turnStarted)
  yield* input.context.tool.hook("execute.before", (event) => {
    const items = input.items()
    if (!OpenCodeEnvironmentTools.names.includes(event.tool) || items.length === 0) return Effect.void
    return copying.withPermit(
      Effect.map(copies.ensure(items), (failures) => {
        if (failures.length > 0)
          notes.set(event.id, failures.map((failure) => failure.item.note(failure.message)).join("\n"))
      }),
    )
  })
  yield* input.context.tool.hook("execute.after", (event) =>
    Effect.sync(() => {
      const note = notes.get(event.id)
      if (!note) return
      notes.delete(event.id)
      if (event.status === "error") {
        event.error = new Tool.Error({ message: `${event.error.message}\n\n${note}` })
        return
      }
      const content = event.result.content
      event.result = {
        ...event.result,
        content:
          typeof content === "string"
            ? `${content}\n\n${note}`
            : [
                ...(content ??
                  ("output" in event.result
                    ? [{ type: "text" as const, text: JSON.stringify(event.result.output) }]
                    : [])),
                { type: "text" as const, text: note },
              ],
      }
    }),
  )
})
