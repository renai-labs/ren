import { Credential } from "@ren/schema/credential"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

const secret = "A credential write puts a secret or its owner change in the model’s context."

export const CredentialGroup = Primitive.group(Credential.definition, "sdk", [
  Primitive.list(Credential.definition),
  Primitive.get(Credential.definition),
  Primitive.create(Credential.definition).annotate(Mcp.Hidden, secret),
  Primitive.update(Credential.definition).annotate(Mcp.Hidden, secret),
  Primitive.action(Credential.definition, "rotate", { invalid: true }).annotate(Mcp.Hidden, secret),
  Primitive.action(Credential.definition, "move").annotate(Mcp.Hidden, secret),
  Primitive.action(Credential.definition, "copy").annotate(Mcp.Hidden, secret),
  Primitive.action(Credential.definition, "remove").annotate(Mcp.Hidden, secret),
])
