import { Policy } from "@ren/schema/policy"
import { Effect } from "effect"
import { Access } from "../src/access.js"

console.log(Policy.describe(Effect.runSync(Access.documents)))
