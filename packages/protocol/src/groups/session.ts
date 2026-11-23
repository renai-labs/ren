import { Session } from "@ren/schema/session"
import { OpenApi } from "effect/http-api"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const SessionGroup = Primitive.group(Session.definition, "sdk", [
  Primitive.list(Session.definition),
  Primitive.get(Session.definition),
  Primitive.create(Session.definition),
  Primitive.archive(Session.definition),
  Primitive.action(Session.definition, "import", { invalid: true })
    .annotateMerge(
      OpenApi.annotations({
        summary: "Import session",
        description: `Create a session in a space from a transcript that a harness exported, such as a person’s own OpenCode session, with the same ID, history and title. Its brain restores the history when it starts, and the next message goes on from it. Importing the same ID again into the same space, as the same person, starts its brain again and changes nothing else. A body is at most ${Session.maxImportBytes / 1024 / 1024} MiB.`,
      }),
    )
    .annotate(Mcp.Hidden, "An import carries a whole exported transcript, which only a harness client has."),
])
