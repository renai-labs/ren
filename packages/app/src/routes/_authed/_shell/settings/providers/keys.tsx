import { RenInference } from "@ren/schema/ren-inference"
import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { InferenceKeysPage } from "../../../../../features/inference-keys/inference-keys-page.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/providers/keys")({
  head: () => ({ meta: [{ title: "Inference keys · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      key: Schema.optional(Schema.String),
      status: Schema.optional(Schema.Literals(["active", "all"])),
      period: Schema.optional(RenInference.Period),
      q: Schema.optional(Schema.String),
    }),
  ),
  loaderDeps: (options) => ({ period: options.search.period ?? "30d" }),
  loader: (options) => {
    const api = options.context.api["ren-inference"]
    Loader.start(
      options.context.queryClient.query(api.key.list.queryOptions()),
      options.context.queryClient.query(api.key.usage.queryOptions({ period: options.deps.period })),
    )
  },
  component: InferenceKeysPage,
})
