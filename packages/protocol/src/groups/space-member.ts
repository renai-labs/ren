import { SpaceMember } from "@ren/schema/space-member"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const SpaceMemberGroup = Primitive.group(SpaceMember.definition, "sdk", [
  Primitive.list(SpaceMember.definition).annotate(Mcp.Tool, true),
  Primitive.create(SpaceMember.definition),
  Primitive.archive(SpaceMember.definition),
])
