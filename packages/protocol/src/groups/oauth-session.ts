import { OAuthSession } from "@ren/schema/oauth-session"
import { Primitive } from "../primitive.js"

export const OAuthSessionGroup = Primitive.group(OAuthSession.definition, "sdk", [
  Primitive.get(OAuthSession.definition),
])
