export * as AppConnect from "./app-connect.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Option, Predicate, Schema } from "effect"
import { ToolState } from "./tool-state.js"

const Connect = Schema.Struct({ appId: Schema.String, spaceId: Schema.String })

const isConnect = Schema.is(Connect)

const parse = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const calls = Schema.decodeUnknownOption(Schema.Array(Schema.Struct({ tool: Schema.String })))

const called = (content: SessionMessage.Tool) =>
  content.name.endsWith("_app_request_connect") ||
  (content.name === "execute" &&
    Option.exists(calls(ToolState.metadata(content).toolCalls), (list) =>
      list.some((call) => call.tool.endsWith(".app_request_connect")),
    ))

const found = (value: unknown): ReadonlyArray<typeof Connect.Type> => {
  if (isConnect(value)) return [{ appId: value.appId, spaceId: value.spaceId }]
  if (typeof value === "string") return Option.match(parse(value), { onNone: () => [], onSome: found })
  return Predicate.isObjectOrArray(value) ? Object.values(value).flatMap(found) : []
}

export const of = (content: SessionMessage.Tool) =>
  content.state.status === "completed" && called(content)
    ? found(ToolState.output(content) ?? "").filter(
        (connect, index, all) =>
          all.findIndex((each) => each.appId === connect.appId && each.spaceId === connect.spaceId) === index,
      )
    : []

export const shown = (content: SessionMessage.Tool) => of(content).length > 0
