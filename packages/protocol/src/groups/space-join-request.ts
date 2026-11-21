import { SpaceJoinRequest } from "@ren/schema/space-join-request"
import { Primitive } from "../primitive.js"

export const SpaceJoinRequestGroup = Primitive.group(SpaceJoinRequest.definition, "sdk", [
  Primitive.list(SpaceJoinRequest.definition),
  Primitive.create(SpaceJoinRequest.definition),
  Primitive.action(SpaceJoinRequest.definition, "approve"),
  Primitive.action(SpaceJoinRequest.definition, "decline"),
  Primitive.action(SpaceJoinRequest.definition, "cancel"),
])
