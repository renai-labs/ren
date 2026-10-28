import { SpaceMember } from "@ren/schema/space-member"
import { Primitive } from "../primitive.js"

export const SpaceMemberGroup = Primitive.group(SpaceMember.definition, "sdk", [
  Primitive.list(SpaceMember.definition),
  Primitive.create(SpaceMember.definition),
  Primitive.archive(SpaceMember.definition),
])
