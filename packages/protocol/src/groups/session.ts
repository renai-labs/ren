import { Session } from "@ren/schema/session"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const SessionGroup = Primitive.group(Session.definition, "sdk", [
  Primitive.list(Session.definition).annotate(Mcp.Tool, true),
  Primitive.get(Session.definition).annotate(Mcp.Tool, true),
  Primitive.create(Session.definition).annotate(Mcp.Tool, true),
  Primitive.archive(Session.definition),
])
