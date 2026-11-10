export * as OpenCodeBrowsers from "./browsers.js"

import type { Plugin } from "@opencode/plugin/effect"
import type { SessionID } from "@opencode/schema/session-id"
import { Effect, Option, Predicate, Schema } from "effect"
import type { Browsers } from "../../browser.js"

const tool = "manage_browsers"

// oxlint-disable-next-line ren/no-comments -- Kernel's MCP tool, under the namespace of the app's server; Code Mode calls pass through the same hooks.
const isManageBrowsers = (name: string) => name === tool || name.endsWith(`_${tool}`)

const Action = Schema.Struct({ action: Schema.String, session_id: Schema.optionalKey(Schema.String) })

const Created = Schema.Struct({
  browser: Schema.Struct({
    session_id: Schema.String,
    browser_live_view_url: Schema.String,
    cdp_ws_url: Schema.String,
  }),
})

export const register = (
  context: Plugin.Context,
  browsers: Browsers.Interface,
  rootOf: (sessionID: SessionID) => Effect.Effect<SessionID>,
) =>
  Effect.all(
    [
      // oxlint-disable-next-line ren/no-comments -- Kiosk mode hides Chromium's own toolbar, so the live view shows only the page under the chat's toolbar.
      context.tool.hook("execute.before", (event) =>
        Effect.sync(() => {
          if (!isManageBrowsers(event.tool) || !Predicate.isObject(event.input)) return
          if (event.input.action === "create" && !("kiosk_mode" in event.input))
            event.input = { ...event.input, kiosk_mode: true }
        }),
      ),
      context.tool.hook("execute.after", (event) =>
        Effect.gen(function* () {
          if (!isManageBrowsers(event.tool) || event.status !== "completed") return
          const action = Option.getOrUndefined(Schema.decodeUnknownOption(Action)(event.input))
          if (action?.action === "create") {
            const created = Option.getOrUndefined(Schema.decodeUnknownOption(Created)(event.result.output))?.browser
            if (!created) return
            yield* browsers.record(yield* rootOf(event.sessionID), {
              id: created.session_id,
              provider: "kernel",
              liveView: created.browser_live_view_url,
              cdp: created.cdp_ws_url,
            })
          }
          if (action?.action === "delete" && action.session_id)
            yield* browsers.forget(yield* rootOf(event.sessionID), action.session_id)
        }),
      ),
    ],
    { discard: true },
  )
