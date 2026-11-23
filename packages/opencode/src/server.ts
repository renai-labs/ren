import { Plugin } from "@opencode/plugin/effect"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { RenAuth } from "./auth.js"
import { Binding } from "./binding.js"
import { Controls } from "./controls.js"
import { RenHandlers } from "./handlers.js"
import { Link } from "./link.js"
import { Mirror } from "./mirror.js"
import { RenProvider } from "./provider.js"
import { RenApi } from "./ren.js"
import { Requests } from "./requests.js"
import { Sessions } from "./sessions.js"
import { Status } from "./status.js"
import { Support } from "./support.js"
import { Title } from "./title.js"

export default Plugin.define({
  id: "ren",
  effect: (ctx) => {
    const refused = Support.refusal(ctx.app)
    if (refused) return Effect.logWarning(refused)
    return Layer.build(
      Status.layer(ctx).pipe(
        Layer.provideMerge(Sessions.layer(ctx)),
        Layer.provideMerge(RenProvider.layer(ctx)),
        Layer.provideMerge(Mirror.layer(ctx)),
        Layer.provideMerge(Layer.mergeAll(Title.layer(ctx), Requests.layer(ctx))),
        Layer.provideMerge(Layer.mergeAll(Link.layer, Binding.layer(ctx))),
        Layer.provideMerge(RenApi.layer),
        Layer.provideMerge(RenAuth.layer(ctx.options)),
        Layer.provide(FetchHttpClient.layer),
      ),
    ).pipe(
      Effect.flatMap((services) =>
        RenHandlers.register(ctx).pipe(Effect.andThen(Controls.register(ctx)), Effect.provideContext(services)),
      ),
      Effect.catch((error) => Effect.logWarning("The Ren plugin registers nothing", error)),
    )
  },
})
