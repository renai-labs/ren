export * as ImageGeneration from "./image-generation.js"

import { Effect, Schema, Struct } from "effect"
import { basename, extname } from "node:path"
import { Images } from "./images.js"
import { WorkspaceFiles } from "./workspace-files.js"

export const Input = Images.Parameters.mapFields((fields) => ({
  ...fields,
  model: Schema.optionalKey(
    Schema.NonEmptyString.annotate({
      description: "A model ID from the configured image provider. Omit to use the agent’s default.",
    }),
  ),
  images: Schema.optionalKey(
    Schema.NonEmptyArray(Schema.NonEmptyString).annotate({
      description: "Workspace image paths to edit. Omit to generate new images.",
    }),
  ),
  mask: Schema.optionalKey(
    Schema.NonEmptyString.annotate({ description: "An optional workspace PNG mask for image edits." }),
  ),
  output_path: Schema.optionalKey(
    Schema.NonEmptyString.annotate({
      description:
        "Where to save the first image. Further images add a number before the extension. Defaults to .ren/tools/.",
    }),
  ),
})).annotate({ identifier: "ImageGeneration.Input" })

export const Output = Schema.Struct({
  message: Schema.optionalKey(Schema.String),
  images: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      revisedPrompt: Schema.optionalKey(Schema.String),
    }),
  ),
}).annotate({ identifier: "ImageGeneration.Output" })

export class Invalid extends Schema.TaggedError<Invalid>()("ImageGeneration.Invalid", {
  message: Schema.String,
}) {}

const mediaTypes: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

interface Request extends Omit<typeof Input.Type, "model"> {
  readonly model: string
}

export const run = Effect.fn("ImageGeneration.run")(function* (
  input: Request,
  headers: Readonly<Record<string, string>>,
): Effect.fn.Return<
  typeof Output.Type,
  Invalid | Images.Failure | WorkspaceFiles.Failure,
  Images.Service | WorkspaceFiles.Service
> {
  if (input.mask && !input.images) return yield* new Invalid({ message: "A mask requires input images." })
  const files = yield* WorkspaceFiles.Service
  const images = yield* Images.Service
  const readImage = Effect.fnUntraced(function* (path: string) {
    return new File([new Uint8Array(yield* files.read(path))], basename(path), {
      type: mediaTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
    })
  })
  const inputs = yield* Effect.forEach(input.images ?? [], readImage)
  const mask = input.mask ? { mask: yield* readImage(input.mask) } : {}
  const artifacts = yield* images.generate({
    ...Struct.omit(input, ["images", "mask", "output_path"]),
    headers,
    images: inputs,
    ...mask,
  })
  if (!artifacts.length) return { images: [], message: "No images were returned. Try a different prompt or model." }
  const output = input.output_path ?? `.ren/tools/${crypto.randomUUID()}.${artifacts.at(0)?.format ?? "png"}`
  return {
    images: yield* Effect.forEach(artifacts, (artifact, index) =>
      Effect.gen(function* () {
        const extension = extname(output)
        const path = index === 0 ? output : `${output.slice(0, output.length - extension.length)}.${index}${extension}`
        yield* files.write(path, artifact.bytes)
        return { path, ...(artifact.revisedPrompt && { revisedPrompt: artifact.revisedPrompt }) }
      }),
    ),
  }
})
