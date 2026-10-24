import { OAuthApp } from "@ren/schema/oauth-app"
import { Primitive } from "../primitive.js"

export const OAuthAppGroup = Primitive.group(OAuthApp.definition, "sdk", [
  Primitive.list(OAuthApp.definition),
  Primitive.get(OAuthApp.definition),
  Primitive.create(OAuthApp.definition),
  Primitive.update(OAuthApp.definition),
  Primitive.archive(OAuthApp.definition),
])
