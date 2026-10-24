export * as Mcp from "./mcp.js"

import { Context } from "effect"

export const Tool = Context.Reference<boolean>("@ren/protocol/Mcp/Tool", { defaultValue: () => false })
