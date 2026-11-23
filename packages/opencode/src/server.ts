import { Plugin } from "@opencode/plugin/effect"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { RenAuth } from "./auth.js"
import { Binding } from "./binding.js"
import { Link } from "./link.js"
import { RenProvider } from "./provider.js"
import { RenApi } from "./ren.js"

export default Plugin.define({
  id: "ren",
  effect: (ctx) =>
    Layer.build(
      Layer.mergeAll(Link.layer, Binding.layer(ctx.session, ctx.options)).pipe(
        Layer.provideMerge(RenApi.layer),
        Layer.provide(RenAuth.layer(ctx.options)),
        Layer.provide(FetchHttpClient.layer),
      ),
    ).pipe(
      Effect.flatMap((services) => RenProvider.register(ctx).pipe(Effect.provideContext(services))),
      Effect.catch((error) => Effect.logWarning("The Ren plugin registers nothing", error)),
    ),
})
