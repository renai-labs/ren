export * as RenPlugin from "./plugin.js"

import type { Plugin } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

const unavailable = ["read", "write", "edit", "patch", "glob", "grep", "shell"]

export const plugin: Plugin = {
  id: "ren",
  effect: (context) =>
    context.tool
      .transform((editor) => {
        for (const id of unavailable) editor.remove(id)
      })
      .pipe(Effect.asVoid),
}
