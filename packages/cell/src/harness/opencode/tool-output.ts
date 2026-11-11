export * as RenToolOutput from "./tool-output.js"

import type { EnvironmentFiles } from "@opencode/core/environment/files"
import { Location } from "@opencode/core/location"
import { State } from "@opencode/core/state"
import type { Tool } from "@opencode/core/tool"
import { DIRECTORY, MAX_BYTES, MAX_LINES, Service, fileName } from "@opencode/core/tool-output"
import type { Workspace } from "@opencode/schema/workspace"
import { tags } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Effect, Layer, Option, Predicate } from "effect"
import path from "node:path"

const byteLength = (text: string) => new TextEncoder().encode(text).length

interface Limits {
  maxLines: number
  maxBytes: number
}

// oxlint-disable-next-line ren/no-comments -- The first lines that fit in both limits, as OpenCode's ToolOutput keeps them.
const keptLines = (lines: ReadonlyArray<string>, limits: Limits) => {
  const kept: Array<string> = []
  let bytes = 0
  for (const line of lines.slice(0, limits.maxLines)) {
    const size = byteLength(line) + (kept.length > 0 ? 1 : 0)
    if (bytes + size > limits.maxBytes) break
    kept.push(line)
    bytes += size
  }
  return kept
}

// oxlint-disable-next-line ren/no-comments -- The result's content cut to the kept text, with the marker after the last text it keeps, as OpenCode's ToolOutput cuts it.
const bounded = (content: ReadonlyArray<Tool.Content>, length: number, marker: string) => {
  const items: Array<Tool.Content> = []
  let remaining = length
  let hasText = false
  let isMarked = false
  for (const item of content) {
    if (item.type === "file") {
      items.push(item)
      continue
    }
    if (hasText && remaining > 0) remaining--
    hasText = true
    if (remaining >= item.text.length) {
      items.push(item)
      remaining -= item.text.length
      continue
    }
    if (remaining > 0) items.push({ ...item, text: item.text.slice(0, remaining) })
    if (!isMarked) items.push({ type: "text", text: marker })
    remaining = 0
    isMarked = true
  }
  return isMarked ? items : [...items, { type: "text" as const, text: marker }]
}

// oxlint-disable-next-line ren/no-comments -- OpenCode's ToolOutput saves a long result on the brain's disk (`tool-output.ts:56-57`). With a remote hand it goes to the hand, beside the shell's output files, so the chat's read tool finds it there. The files go with the hand; there is no cleanup.
const layer = (filesOf: (workspaceId: Workspace.ID) => EnvironmentFiles.FilesImpl) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const location = yield* Location.Service
      const global = yield* Global.Service
      const files = Option.map(Option.fromNullishOr(location.workspaceID), filesOf)
      const state = State.create<Limits, { readonly configure: (limits: Partial<Limits>) => void }>({
        name: "tool-output",
        initial: () => ({ maxLines: MAX_LINES, maxBytes: MAX_BYTES }),
        editor: (editor) => ({
          configure: (limits) => {
            if (Predicate.isNumber(limits.maxLines)) editor.maxLines = limits.maxLines
            if (Predicate.isNumber(limits.maxBytes)) editor.maxBytes = limits.maxBytes
          },
        }),
      })
      const truncate = Effect.fnUntraced(function* (result: Tool.NormalizedResult) {
        if (Predicate.isBoolean(result.metadata?.truncated)) return result
        const text = result.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
        const limits = state.get()
        const lines = text.split("\n")
        if (text.endsWith("\n")) lines.pop()
        if (lines.length <= limits.maxLines && byteLength(text) <= limits.maxBytes)
          return { ...result, metadata: { ...result.metadata, truncated: false } }
        const kept = keptLines(lines, limits)
        const file = path.join(global.data, DIRECTORY, fileName())
        const saved = Option.isSome(files)
          ? yield* files.value.write(file, new TextEncoder().encode(text)).pipe(
              Effect.as(true),
              Effect.catchCause((cause) =>
                Effect.logWarning("Saving a tool's full output on the hand failed", cause).pipe(Effect.as(false)),
              ),
            )
          : false
        const shown = kept.length > 0 ? `lines 1-${kept.length}` : "0 lines"
        const marker = `[showing ${shown} of ${lines.length}; ${saved ? `full output saved to ${file}` : "the full output was not saved"}]`
        return {
          ...result,
          content: bounded(result.content, kept.join("\n").length, marker),
          metadata: { ...result.metadata, truncated: true, ...(saved && { outputPath: file }) },
        }
      })
      const save = Effect.fnUntraced(function* (bytes: Uint8Array, extension: string) {
        const file = path.join(global.data, DIRECTORY, fileName() + extension)
        if (Option.isNone(files)) return yield* Effect.die(new Error("A tool's output cannot be saved without a hand"))
        yield* files.value.write(file, bytes).pipe(Effect.orDie)
        return file
      })
      return Service.of({
        transform: state.transform,
        reload: state.reload,
        truncate,
        save,
        cleanup: () => Effect.void,
      })
    }),
  )

export const node = (filesOf: (workspaceId: Workspace.ID) => EnvironmentFiles.FilesImpl) =>
  LayerNode.make({
    service: Service,
    tag: tags.values.location,
    layer: layer(filesOf),
    deps: [Location.node, Global.node],
  })
