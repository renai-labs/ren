export * as Integrations from "./integrations.js"

import { Config } from "effect"

export const label = "INTEGRATIONS"

// oxlint-disable-next-line ren/no-comments -- Where the integrations service serves the managed MCPs. Without it, this Ren has no managed MCPs. A value that is not a URL stops Ren at startup.
export const url = Config.option(Config.URL("REN_INTEGRATIONS_URL"))
