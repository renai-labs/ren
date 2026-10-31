import { Effect, Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"

const Widget = Schema.Struct({ id: Schema.String, name: Schema.String })

export const Api = HttpApi.make("test").add(
  HttpApiGroup.make("widget")
    .add(
      HttpApiEndpoint.get("widget.list", "/widgets", {
        query: {
          ownerId: Schema.String,
          status: Schema.optional(Schema.Literals(["active", "archived"])),
          page: Schema.optional(Schema.Int),
          pageSize: Schema.Int.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(20))),
        },
        success: Schema.Array(Widget),
      }).annotateMerge(OpenApi.annotations({ identifier: "widget.list", summary: "List widgets" })),
    )
    .add(
      HttpApiEndpoint.get("widget.get", "/widgets/:idOrSlug", {
        params: { idOrSlug: Schema.String },
        success: Widget,
      }).annotateMerge(OpenApi.annotations({ identifier: "widget.get", summary: "Get widget" })),
    )
    .add(
      HttpApiEndpoint.patch("widget.update", "/widgets/:id", {
        params: { id: Schema.String },
        payload: Schema.Struct({
          name: Schema.optional(Schema.String.annotate({ description: "Widget name" })),
          tags: Schema.optional(Schema.Array(Schema.String)),
          settings: Schema.optional(Schema.Struct({ color: Schema.String })),
        }),
        success: Widget,
      }).annotateMerge(OpenApi.annotations({ identifier: "widget.update", summary: "Update widget" })),
    ),
)
