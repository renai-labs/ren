import { expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node-shared"
import { testEffect } from "@ren/executor/testing"
import { Effect, FileSystem, Layer, Redacted, Result, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Images } from "../src/images.js"
import { ImageGeneration } from "../src/image-generation.js"
import { WorkspaceFiles } from "../src/workspace-files.js"

const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, FetchHttpClient.layer))

it.live("an empty image response succeeds with an explanatory result and writes no files", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped()
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ created: 1, data: [] }) }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const output = yield* ImageGeneration.run({ prompt: "A logo", model: "image" }, {}).pipe(
      Effect.provide(
        Layer.mergeAll(
          Images.layerRen(
            { id: "ren", baseUrl: server.url.origin, apiKey: { key: Redacted.make("key") } },
            Effect.succeed(Redacted.make("key")),
          ),
          WorkspaceFiles.layerLocal(directory),
        ),
      ),
    )
    expect(output).toEqual({ images: [], message: "No images were returned. Try a different prompt or model." })
    expect(yield* fs.readDirectory(directory)).toEqual([])
  }),
)

it.live("images use the configured default, renew once, edit input files, and save base64 and URL artifacts", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped()
    yield* fs.writeFileString(`${directory}/input.png`, "input image")
    const calls: Array<{
      path: string
      key: string | null
      route: string | null
      claim: string | null
      model: string
      image?: string
      imageType?: string
    }> = []
    let keyReads = 0
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: async (request) => {
            const path = new URL(request.url).pathname
            if (path === "/artifact") {
              expect(request.headers.get("authorization")).toBeNull()
              return new Response("downloaded image")
            }
            const edit = path.endsWith("/edits")
            // oxlint-disable-next-line typescript/no-deprecated -- The local provider reads one small multipart upload.
            const form = edit ? await request.formData() : undefined
            const body = edit
              ? undefined
              : Schema.decodeUnknownSync(Schema.Struct({ model: Schema.String }))(await request.json())
            const file = form?.get("image")
            calls.push({
              path,
              key: request.headers.get("authorization"),
              route: request.headers.get("x-route"),
              claim: request.headers.get("x-claim"),
              model: Schema.decodeUnknownSync(Schema.String)(form?.get("model") ?? body?.model),
              ...(file instanceof File && { image: await file.text(), imageType: file.type }),
            })
            if (calls.length === 1) return Response.json({ error: { message: "expired" } }, { status: 401 })
            return Response.json({
              created: 1,
              data: [{ b64_json: btoa("generated image") }, { url: new URL("/artifact", request.url).href }],
            })
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const layers = Layer.mergeAll(
      Images.layerRen(
        {
          id: "ren",
          baseUrl: `${server.url.origin}/v1`,
          apiKey: { key: Redacted.make("initial") },
          headers: { "x-route": "images" },
        },
        Effect.sync(() => Redacted.make(++keyReads === 1 ? "expired" : "fresh")),
      ),
      WorkspaceFiles.layerLocal(directory),
    )
    const selection = {
      catalog: {
        providerId: "ren",
        models: [
          { id: "first", upstreamId: "wrong" },
          { id: "chosen", upstreamId: "ren/chosen" },
        ],
      },
      defaultModel: { providerId: "ren", modelId: "chosen" },
      headers: { "x-claim": "turn" },
    }
    const generated = yield* ImageGeneration.run(
      Result.getOrThrow(ImageGeneration.prepare({ prompt: "A logo", output_path: "logo.png" }, selection)),
      selection.headers,
    ).pipe(Effect.provide(layers))
    expect(generated.images.map((image) => image.path)).toEqual(["logo.png", "logo.1.png"])
    expect(yield* fs.readFileString(`${directory}/logo.png`)).toBe("generated image")
    expect(yield* fs.readFileString(`${directory}/logo.1.png`)).toBe("downloaded image")
    yield* ImageGeneration.run(
      Result.getOrThrow(ImageGeneration.prepare({ prompt: "Edit", images: ["input.png"], model: "first" }, selection)),
      selection.headers,
    ).pipe(Effect.provide(layers))
    expect(calls).toEqual([
      { path: "/v1/images/generations", key: "Bearer expired", route: "images", claim: "turn", model: "ren/chosen" },
      { path: "/v1/images/generations", key: "Bearer fresh", route: "images", claim: "turn", model: "ren/chosen" },
      {
        path: "/v1/images/edits",
        key: "Bearer fresh",
        route: "images",
        claim: "turn",
        model: "wrong",
        image: "input image",
        imageType: "image/png",
      },
    ])
    const invalid = ImageGeneration.prepare({ prompt: "No request", model: "missing" }, selection)
    expect(Result.isFailure(invalid) && invalid.failure).toBeInstanceOf(ImageGeneration.Invalid)
    expect(calls).toHaveLength(3)
  }),
)
