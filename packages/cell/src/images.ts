export * as Images from "./images.js"

import { Generated, OpenAiClientGenerated, OpenAiConfig } from "@effect/ai-openai"
import type { ModelTypes } from "@ren/schema/model-types"
import { Cause, Context, Effect, Layer, Redacted, Schema, Struct } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ModelHttp } from "./model-http.js"

export const Parameters = Generated.CreateImageRequest.mapFields(
  Struct.pick(["prompt", "n", "size", "background", "output_format"]),
)

export class Failure extends Schema.TaggedError<Failure>()("Images.Failure", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

interface Artifact {
  readonly bytes: Uint8Array
  readonly format: NonNullable<Generated.ImagesResponse["output_format"]>
  readonly revisedPrompt?: string
}

interface Request extends Schema.Schema.Type<typeof Parameters> {
  readonly model: string
  readonly images?: ReadonlyArray<File>
  readonly mask?: File
  readonly headers: Readonly<Record<string, string>>
}

export interface Interface {
  readonly generate: (request: Request) => Effect.Effect<ReadonlyArray<Artifact>, Failure>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Images") {}

export const layerRen = (provider: ModelTypes.Provider, key: Effect.Effect<Redacted.Redacted>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const client = yield* OpenAiClientGenerated.make(ModelHttp.options(provider, key))
      return Service.of({
        generate: Effect.fn("Images.generate")(
          function* (input) {
            const payload = Struct.omit(input, ["images", "mask", "headers"])
            const response = input.images?.length
              ? yield* client.createImageEdit({
                  payload: { ...payload, image: input.images, ...(input.mask && { mask: input.mask }) },
                })
              : yield* client.createImage({ payload })
            return yield* Effect.forEach(response.data ?? [], (image) =>
              Effect.gen(function* () {
                let bytes: Uint8Array
                if (image.b64_json)
                  bytes = yield* Schema.decodeUnknownEffect(Schema.Uint8ArrayFromBase64)(image.b64_json)
                else if (image.url)
                  bytes = new Uint8Array(
                    yield* HttpClient.filterStatusOk(http)
                      .get(image.url)
                      .pipe(Effect.flatMap((response) => response.arrayBuffer)),
                  )
                else
                  return yield* new Failure({
                    message: "The provider returned an image without bytes or a URL.",
                    cause: image,
                  })
                return {
                  bytes,
                  format: response.output_format ?? input.output_format ?? "png",
                  ...(image.revised_prompt && { revisedPrompt: image.revised_prompt }),
                }
              }),
            )
          },
          (effect, input) =>
            effect.pipe(
              OpenAiConfig.withClientTransform(HttpClient.mapRequest(HttpClientRequest.setHeaders(input.headers))),
            ),
          Effect.mapError((cause) =>
            cause instanceof Failure ? cause : new Failure({ message: Cause.pretty(Cause.fail(cause)), cause }),
          ),
        ),
      })
    }),
  )
