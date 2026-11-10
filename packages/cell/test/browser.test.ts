import { expect } from "bun:test"
import { Plugin } from "@opencode/plugin/effect"
import { Mcp } from "@opencode/schema/mcp"
import { SessionID } from "@opencode/schema/session-id"
import { testEffect } from "@ren/executor/testing"
import type { Browser } from "@ren/schema/browser"
import type { SessionEvent } from "@ren/schema/session/event"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Exit, Fiber, Layer, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Browsers } from "../src/browser.js"
import { BrainTest } from "./lib/brain.js"
import { KernelPeer } from "./lib/kernel.js"
import { ModelsTest } from "./lib/models.js"
import { Shared } from "./lib/shared.js"

const it = testEffect(Layer.empty)

const kernelServer = (url: string, options: { readonly codemode: boolean }) =>
  Plugin.define({
    id: "kernel-test",
    effect: (context) =>
      context.mcp
        .transform((editor) => {
          editor.set("kernel", new Mcp.RemoteConfig({ type: "remote", url, oauth: false, codemode: options.codemode }))
        })
        .pipe(Effect.asVoid),
  })

const opened = Effect.fnUntraced(function* (options: { readonly codemode: boolean }) {
  const kernel = yield* KernelPeer.make()
  const brain = yield* BrainTest.make({ plugin: kernelServer(kernel.url, options) })
  yield* brain.start()
  const frames = yield* Queue.unbounded<SessionEvent.Frame>()
  yield* (yield* brain.chat.event["event.subscribe"]()).pipe(
    Stream.runForEach((frame) => Queue.offer(frames, frame)),
    Effect.forkScoped,
  )
  const params = { sessionID: brain.id }
  const turn = Effect.fnUntraced(function* (tool: { readonly name: string; readonly input: unknown }) {
    const script = Shared.stub().script({ tools: [tool] })
    yield* brain.chat.session["session.prompt"]({
      params,
      payload: { id: SessionMessage.ID.create(), text: `${script.marker} use the browser`, delivery: "steer" },
    })
    yield* brain.opencode.experimental.session.wait({ sessionID: SessionID.make(brain.id) })
  })
  const event = (type: string) => Queue.take(frames).pipe(Effect.repeat({ until: (frame) => frame.type === type }))
  const watch = Effect.gen(function* () {
    const pages = yield* Queue.unbounded<Browser.Info>()
    const fiber = yield* (yield* brain.chat.browser["browser.watch"]({ params })).pipe(
      Stream.runForEach((page) => Queue.offer(pages, page)),
      Effect.forkScoped,
    )
    return {
      fiber,
      until: (url: string) => Queue.take(pages).pipe(Effect.repeat({ until: (page) => page.url === url })),
    }
  })
  return { kernel, brain, params, turn, event, watch }
})

it.live("a browser created in Code Mode opens in kiosk mode, and a watcher follows and drives its page", () =>
  Effect.gen(function* () {
    const test = yield* opened({ codemode: true })
    yield* test.turn({
      name: "execute",
      input: { code: `return await tools.kernel.manage_browsers({ action: "create" })` },
    })
    expect(test.kernel.calls).toEqual([{ action: "create", kiosk_mode: true }])
    expect((yield* test.event("browser.opened")).data).toEqual({ sessionID: test.brain.id, id: "browser_1" })
    expect(yield* test.brain.chat.browser["browser.get"]({ params: test.params })).toEqual({
      id: "browser_1",
      provider: "kernel",
      liveView: "https://live.kernel.test/browser_1",
      url: "",
      title: "",
      canGoBack: false,
      canGoForward: false,
    })
    expect(test.kernel.opened()).toBe(0)

    const watcher = yield* test.watch
    expect(yield* watcher.until("https://example.com/")).toMatchObject({ title: "Example", canGoBack: false })
    yield* test.brain.chat.browser["browser.navigate"]({
      params: test.params,
      payload: { url: "https://example.org/" },
    })
    expect(yield* watcher.until("https://example.org/")).toMatchObject({ canGoBack: true, canGoForward: false })
    yield* test.brain.chat.browser["browser.navigate"]({ params: test.params, payload: { history: "back" } })
    expect(yield* watcher.until("https://example.com/")).toMatchObject({ canGoBack: false, canGoForward: true })
    expect(yield* test.brain.chat.browser["browser.get"]({ params: test.params })).toMatchObject({
      url: "https://example.com/",
    })
    expect(test.kernel.opened()).toBe(1)
  }),
)

it.live("a browser created directly is recorded, and deleting it ends the watch and forgets it", () =>
  Effect.gen(function* () {
    const test = yield* opened({ codemode: false })
    yield* test.turn({ name: "kernel_manage_browsers", input: { action: "create", kiosk_mode: false } })
    expect(test.kernel.calls).toEqual([{ action: "create", kiosk_mode: false }])
    yield* test.event("browser.opened")
    const watcher = yield* test.watch
    yield* watcher.until("https://example.com/")

    yield* test.turn({ name: "kernel_manage_browsers", input: { action: "delete", session_id: "browser_1" } })
    expect((yield* test.event("browser.closed")).data).toEqual({ sessionID: test.brain.id, id: "browser_1" })
    expect(Exit.isSuccess(yield* Fiber.await(watcher.fiber))).toBe(true)
    const missing = yield* test.brain.chat.browser["browser.get"]({ params: test.params }).pipe(Effect.flip)
    expect(missing._tag).toBe("NotFoundError")
  }),
)

it.effect("the CDP socket is shared by watchers and closes 5 seconds after the last one leaves", () =>
  Effect.gen(function* () {
    const kernel = yield* KernelPeer.make()
    const browsers = yield* Browsers.Service
    yield* browsers.record("ses_1", {
      id: "browser_1",
      provider: "kernel",
      liveView: "https://live.kernel.test/browser_1",
      cdp: kernel.cdp("browser_1"),
    })
    const follow = Effect.gen(function* () {
      const pages = yield* Queue.unbounded<Browser.Info>()
      const fiber = yield* (yield* browsers.watch("ses_1")).pipe(
        Stream.runForEach((page) => Queue.offer(pages, page)),
        Effect.forkScoped,
      )
      yield* Queue.take(pages)
      return fiber
    })
    const first = yield* follow
    const second = yield* follow
    expect(kernel.opened()).toBe(1)

    yield* Fiber.interrupt(first)
    yield* TestClock.adjust("5 seconds")
    expect(kernel.open()).toBe(1)

    yield* Fiber.interrupt(second)
    yield* TestClock.adjust("4 seconds")
    expect(kernel.open()).toBe(1)
    yield* TestClock.adjust("1 second")
    yield* kernel.closed
    expect(kernel.open()).toBe(0)
  }).pipe(Effect.provide(Browsers.layer.pipe(Layer.provide(ModelsTest.storage())))),
)
