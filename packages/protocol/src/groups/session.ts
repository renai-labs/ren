import { Session } from "@ren/schema/session"
import { Primitive } from "../primitive.js"

export const SessionGroup = Primitive.group(Session.definition, "sdk", [
  Primitive.list(Session.definition),
  Primitive.get(Session.definition),
  Primitive.create(Session.definition),
  Primitive.archive(Session.definition),
])
