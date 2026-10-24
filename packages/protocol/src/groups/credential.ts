import { Credential } from "@ren/schema/credential"
import { Primitive } from "../primitive.js"

export const CredentialGroup = Primitive.group(Credential.definition, "sdk", [
  Primitive.list(Credential.definition),
  Primitive.get(Credential.definition),
  Primitive.create(Credential.definition),
  Primitive.update(Credential.definition),
  Primitive.action(Credential.definition, "rotate", { invalid: true }),
  Primitive.action(Credential.definition, "move"),
  Primitive.action(Credential.definition, "copy"),
  Primitive.action(Credential.definition, "remove"),
])
