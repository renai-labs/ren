export * as RenConnect from "./ren-connect.js"

import type { Tool } from "@opencode/schema/tool"
import { Credential } from "@ren/schema/credential"
import { Effect, Schema } from "effect"

export const name = "ren_connect"

export const Input = Schema.Struct({
  label: Credential.EnvName.annotate({ description: "The label from the denial, for example STRIPE_API_KEY." }),
})

// oxlint-disable-next-line ren/no-comments -- The tool takes a label only: hosts come from a declaration or from the person, never from the agent (A40). The app draws the connect card from this tool part; the person's "connected <LABEL>" message starts the next turn (A9, A42).
export const run = (input: typeof Input.Type) =>
  Effect.succeed({
    content: `Ren asked the person to connect ${input.label}. Tell them in one sentence what it is for, then end your turn. When they connect it, a message "connected ${input.label}" starts your next turn; try the request again then.`,
    metadata: { label: input.label },
  })

export const tool: Tool.Info<typeof Input> = {
  name,
  input: Input,
  description:
    "Ask the person to connect a missing credential. Call it when a request answers ren_credential_missing, with the label from that answer. After the call, reply in one sentence and end your turn.",
  execute: (input) => run(input),
  options: { codemode: false },
}

export const instruction = [
  "Credentials are environment variables that hold placeholders such as ren:STRIPE_API_KEY.",
  "Use these values unchanged: Ren's egress puts the real value into the request after it leaves this machine.",
  `When a request answers 403 with "ren_credential_missing" and a label, call ${name} with that label.`,
].join(" ")
