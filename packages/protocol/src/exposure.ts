import { Context } from "effect"

export class Exposure extends Context.Service<Exposure, "internal" | "sdk" | "mcp">()("@ren/protocol/Exposure") {}
