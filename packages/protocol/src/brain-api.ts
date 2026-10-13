import { HttpApi, OpenApi } from "effect/http-api"
import { BrainGroup } from "./groups/brain.js"

export const BrainApi = HttpApi.make("brain")
  .add(BrainGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Brain API",
      version: "0.0.0",
      description: "What any host of a session serves to the Ren server. Internal, not part of the public API.",
    }),
  )
