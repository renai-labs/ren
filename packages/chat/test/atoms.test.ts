import { expect, setDefaultTimeout, test } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { DateTime, Effect, Layer, Option, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"
import { ChatAtoms } from "../src/atoms.js"
import { TimelineRow } from "../src/timeline-row.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()

test("the timeline atom of a session shows a prompt and its reply as rows", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.make()
    yield* brain.start()
    const http = FetchHttpClient.layer.pipe(
      Layer.provide(
        Layer.succeed(
          FetchHttpClient.Fetch,
          Object.assign(
            (input: string | URL | Request, init?: RequestInit) => {
              const url = new URL(input instanceof Request ? input.url : String(input))
              return brain.chatFetch(`${url.pathname}${url.search}`, input instanceof Request ? input : (init ?? {}))
            },
            { preconnect: fetch.preconnect },
          ),
        ),
      ),
    )
    const atoms = ChatAtoms.make({
      runtime: Atom.runtime(http),
      access: () =>
        Effect.sync(() => ({
          url: "http://cell",
          token: "a-client-token",
          expiresAt: DateTime.makeUnsafe(Date.now() + 3_600_000),
        })),
    })
    const registry = AtomRegistry.make()
    yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
    const timeline = atoms.timeline(brain.id)
    const status = atoms.status(brain.id)
    yield* Effect.addFinalizer(() => Effect.sync(registry.mount(timeline)))
    const until = <A>(atom: Atom.Atom<A>, predicate: (value: A) => boolean) =>
      AtomRegistry.toStream(registry, atom).pipe(
        Stream.filter(predicate),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeoutOrElse({
          duration: "20 seconds",
          orElse: () => Effect.die(new Error("The atom never reached the expected value")),
        }),
      )
    yield* until(status, (value) => AsyncResult.isSuccess(value) && value.value === "connected")
    yield* atoms.run(registry, brain.id, (opened) =>
      opened.prompt({ text: stub.script({ reply: "rows for the UI" }).marker }),
    )
    const rows = yield* until(
      timeline,
      (value) =>
        AsyncResult.isSuccess(value) &&
        value.value.rows.some((row) => row._tag === "AssistantPart") &&
        !value.value.rows.some((row) => row._tag === "Thinking"),
    )
    expect(AsyncResult.isSuccess(rows) && rows.value.rows.map(TimelineRow.key)).toEqual([
      expect.stringMatching(/^user-message:/),
      expect.stringMatching(/^assistant-part:part:/),
    ])
  }).pipe(Effect.scoped, Effect.runPromise))
