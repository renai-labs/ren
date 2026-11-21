export * as HostName from "./host-name.js"

import { Schema } from "effect"

const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"

export const Pattern = Schema.String.check(
  Schema.isMaxLength(253),
  Schema.isPattern(new RegExp(`^(?:\\*\\.)?(?:${label}\\.)+[a-z][a-z0-9-]*[a-z0-9]$`, "u"), {
    message: "Use a host name such as api.example.com, or *.example.com.",
  }),
).annotate({
  identifier: "HostName.Pattern",
  description: "A host name, or `*.<domain>` for its subdomains.",
})
