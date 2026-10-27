import { describe, expect, test } from "bun:test"
import { Form } from "@ren/schema/form"
import { Permission } from "@ren/schema/permission"
import { SessionMessage } from "@ren/schema/session/message"
import { Shell } from "@ren/schema/shell"
import { Schema } from "effect"
import { ChatState } from "../src/chat-state.js"
import { Family } from "../src/family.js"
import { Hydrate } from "../src/hydrate.js"
import { Fixture } from "./lib/fixture.js"

const sessions = (
  list: ReadonlyArray<{
    readonly id: string
    readonly parentID?: string
    readonly title?: string
    readonly time?: object
  }>,
) =>
  Hydrate.info(
    ChatState.empty,
    list.map((item) => Fixture.session(item.id, item)),
  )

const permission = (id: string, sessionID: string) =>
  Schema.decodeUnknownSync(Permission.Request)({ id, sessionID, action: "webfetch", resources: [] })

const question = (id: string, sessionID: string, kind = "question") =>
  Schema.decodeUnknownSync(Form.Info)({
    id,
    sessionID,
    title: "Questions",
    kind,
    fields: [{ key: "q0", type: "string" }],
  })

const search = (id: string, sessionID: string) => question(id, sessionID, "websearch.provider")

describe("sessionTreeIDs", () => {
  test("returns only the current session and its descendants", () => {
    const state = sessions([
      { id: "ses_root" },
      { id: "ses_child", parentID: "ses_root" },
      { id: "ses_grand", parentID: "ses_child" },
      { id: "ses_sibling", parentID: "ses_root" },
      { id: "ses_other" },
    ])
    expect(Family.tree(state, "ses_child")).toEqual(["ses_child", "ses_grand"])
    expect(Family.tree(state, "ses_root")).toEqual(["ses_root", "ses_child", "ses_sibling", "ses_grand"])
  })
})

const tree = sessions([
  { id: "ses_root" },
  { id: "ses_child", parentID: "ses_root" },
  { id: "ses_grand", parentID: "ses_child" },
  { id: "ses_other" },
])

describe("sessionPermissionRequest", () => {
  const both = { ses_root: [permission("perm-root", "ses_root")], ses_child: [permission("perm-child", "ses_child")] }

  test.each([
    ["prefers the current session permission", both, undefined, "perm-root"],
    [
      "returns a nested child permission",
      { ses_grand: [permission("perm-grand", "ses_grand")], ses_other: [permission("perm-other", "ses_other")] },
      undefined,
      "perm-grand",
    ],
    [
      "returns undefined without a matching tree permission",
      { ses_other: [permission("perm-other", "ses_other")] },
      undefined,
      undefined,
    ],
    [
      "skips filtered permissions in the current tree",
      both,
      (item: Permission.Request) => item.id !== "perm-root",
      "perm-child",
    ],
    ["returns undefined when all tree permissions are filtered out", both, () => false, undefined],
  ] as const)("%s", (_name, permissions, include, id) => {
    expect<string | undefined>(Family.permission({ ...tree, permissions }, "ses_root", include)?.id).toBe(id)
  })
})

describe("sessionFormRequest", () => {
  test.each([
    [
      "prefers the current session question",
      { ses_root: [question("frm_root", "ses_root")], ses_child: [question("frm_child", "ses_child")] },
      "frm_root",
    ],
    ["returns a nested child question", { ses_grand: [question("frm_grand", "ses_grand")] }, "frm_grand"],
    ["skips unsupported forms", { ses_root: [question("frm_form", "ses_root", "integration")] }, undefined],
    [
      "finds web search consent in a nested child session",
      { ses_child: [search("frm_search", "ses_child")] },
      "frm_search",
    ],
    [
      "keeps web search ahead of a later question",
      { ses_root: [search("frm_search", "ses_root"), question("frm_q", "ses_root")] },
      "frm_search",
    ],
    [
      "keeps a question ahead of a later web search",
      { ses_root: [question("frm_q", "ses_root"), search("frm_search", "ses_root")] },
      "frm_q",
    ],
    [
      "keeps the current session ahead of a child question",
      { ses_root: [search("frm_search", "ses_root")], ses_child: [question("frm_q", "ses_child")] },
      "frm_search",
    ],
  ] as const)("%s", (_name, forms, id) => {
    expect<string | undefined>(Family.form({ ...tree, forms }, "ses_root")?.id).toBe(id)
  })
})

test("a web-search consent form takes the dock from a question, and only a question shows as one", () => {
  const consent = { ...tree, forms: { ses_root: [search("frm_search", "ses_root"), question("frm_q", "ses_root")] } }
  expect<string | undefined>(Family.webSearch(consent, "ses_root")?.id).toBe("frm_search")
  expect(Family.question(consent, "ses_root")).toBeUndefined()
  const asked = { ...tree, forms: { ses_child: [question("frm_q", "ses_child")] } }
  expect<string | undefined>(Family.question(asked, "ses_root")?.id).toBe("frm_q")
  expect(Family.webSearch(asked, "ses_root")).toBeUndefined()
})

test("walks the ancestors from the root, and stops at a cycle", () => {
  expect(Family.ancestors(tree, "ses_grand")).toEqual(["ses_root", "ses_child"])
  expect(Family.ancestors(tree, "ses_root")).toEqual([])
  const cycle = sessions([
    { id: "ses_a", parentID: "ses_b" },
    { id: "ses_b", parentID: "ses_a" },
  ])
  expect(Family.ancestors(cycle, "ses_a")).toEqual(["ses_b"])
})

const subagent = (id: string, status: "running" | "completed", metadata: object, input: object = {}) => ({
  type: "tool",
  id,
  name: "subagent",
  state:
    status === "running"
      ? { status, input, metadata }
      : { status, input, metadata, content: [{ type: "text", text: "started" }] },
  time: { created: 1 },
})

const assistant = (id: string, content: ReadonlyArray<object>, completed?: number) =>
  Fixture.message({
    id,
    type: "assistant",
    agent: "build",
    model: Fixture.model,
    content,
    time: { created: 1, ...(completed && { completed }) },
  })

const transcript = (state: ChatState.State, sessionID: string, list: ReadonlyArray<SessionMessage.Info>) =>
  Hydrate.messages(state, sessionID, Fixture.page(list.toReversed()))

test("a child takes its title from the parent's subagent call, else from its own title without the agent suffix", () => {
  const family = sessions([
    { id: "ses_root", title: "Root" },
    { id: "ses_child", parentID: "ses_root", title: "Look around (@general subagent)" },
    { id: "ses_other", parentID: "ses_root" },
  ])
  expect(Family.childTitle(family, "ses_child", "Session")).toBe("Look around")
  expect(Family.childTitle(family, "ses_other", "Session")).toBe("Session")
  expect(Family.childTitle(family, "ses_root", "Session")).toBe("Root")
  const described = transcript(family, "ses_root", [
    assistant("msg_a", [
      subagent("call_1", "running", { sessionID: "ses_child" }, { description: "Inspect the code" }),
    ]),
  ])
  expect(Family.childTitle(described, "ses_child", "Session")).toBe("Inspect the code")
})

test("background work leaves out what a completion notice reports, and blocking work is the running tools of the open reply", () => {
  const family = sessions([
    { id: "ses_root" },
    { id: "ses_child_done", parentID: "ses_root" },
    { id: "ses_child_live", parentID: "ses_root", title: "Live" },
    { id: "ses_child_blocking", parentID: "ses_root", title: "Blocking" },
  ])
  const loaded = transcript(family, "ses_root", [
    assistant(
      "msg_a",
      [
        subagent("call_done", "completed", { status: "running", sessionID: "ses_child_done" }, { description: "Done" }),
        subagent(
          "call_bg",
          "completed",
          { status: "running", sessionID: "ses_child_bg" },
          { description: "Background" },
        ),
      ],
      2,
    ),
    Fixture.message({
      id: "msg_b",
      type: "synthetic",
      text: "finished",
      metadata: { source: "subagent", childID: "ses_child_done" },
      time: { created: 3 },
    }),
    assistant("msg_c", [
      subagent("call_blocking", "running", { sessionID: "ses_child_blocking" }, { description: "Blocking" }),
    ]),
  ])
  const running: ChatState.State = {
    ...loaded,
    active: { ses_root: "running", ses_child_live: "running", ses_child_blocking: "running" },
  }
  const work = Family.background(running, "ses_root")
  expect(work.blocking).toEqual([
    { type: "subagent", partID: "call_blocking", id: "ses_child_blocking", label: "Blocking" },
  ])
  expect(work.tasks).toEqual([
    { id: "ses_child_bg", type: "subagent", label: "Background" },
    { id: "ses_child_live", type: "subagent", label: "Live" },
  ])
})

test("a running shell outside the transcript is background work, unless the open reply waits for it", () => {
  const shell = (id: string, command: string, sessionID = "ses_root") =>
    Schema.decodeUnknownSync(Shell.Info)({ id, sessionID, status: "running", command, time: { started: 1 } })
  const loaded = transcript(sessions([{ id: "ses_root" }]), "ses_root", [
    assistant("msg_a", [
      {
        type: "tool",
        id: "call_shell",
        name: "shell",
        state: { status: "running", input: { command: "bun test" }, metadata: { shellID: "sh_blocking" } },
        time: { created: 1 },
      },
    ]),
  ])
  const live = Hydrate.shells(loaded, [
    shell("sh_blocking", "bun test"),
    shell("sh_dev", "bun dev"),
    shell("sh_other", "bun lint", "ses_other"),
  ])
  expect(Family.background(live, "ses_root").tasks).toEqual([{ id: "sh_dev", type: "shell", label: "bun dev" }])
})

test("a subagent call finds its child by metadata, else the newest child titled by its description", () => {
  const family = sessions([
    { id: "ses_root" },
    { id: "ses_old", parentID: "ses_root", title: "Inspect the code (@general subagent)" },
    {
      id: "ses_new",
      parentID: "ses_root",
      title: "Inspect the code (@general subagent)",
      time: { created: 5, updated: 5 },
    },
    { id: "ses_else", parentID: "ses_root", title: "Something else", time: { created: 9, updated: 9 } },
  ])
  const call = (metadata: object) =>
    Schema.decodeUnknownSync(SessionMessage.Tool)(
      subagent("call_1", "running", metadata, { description: "Inspect the code", agent: "general" }),
    )
  expect(Family.taskSession(family, "ses_root", call({ sessionID: "ses_old" }))).toBe("ses_old")
  expect(Family.taskSession(family, "ses_root", call({}))).toBe("ses_new")
  expect(Family.taskSession(family, "ses_other", call({}))).toBeUndefined()
})

test("a family needs attention for an open request, else works while any session in it runs", () => {
  const family = sessions([{ id: "ses_root" }, { id: "ses_child", parentID: "ses_root" }])
  expect(Family.attention(family, "ses_root")).toBe("idle")
  expect(Family.attention({ ...family, active: { ses_child: "running" } }, "ses_root")).toBe("running")
  const asking = {
    ...family,
    active: { ses_root: "running" as const },
    forms: { ses_child: [question("frm_1", "ses_child")] },
  }
  expect(Family.attention(asking, "ses_root")).toBe("asking")
  const queued = transcript(family, "ses_root", [])
  expect(
    Family.attention(
      {
        ...queued,
        pending: {
          ses_root: [
            Fixture.inbox({
              id: "msg_q",
              sessionID: "ses_root",
              type: "user",
              delivery: "steer",
              payload: { text: "next" },
              time: { created: 1 },
            }),
          ],
        },
      },
      "ses_root",
    ),
  ).toBe("running")
})

test("a subagent card reads its child's state, tools and requests", () => {
  const family = sessions([{ id: "ses_root" }, { id: "ses_child", parentID: "ses_root", title: "Inspect the code" }])
  const withChild = transcript(family, "ses_child", [
    assistant("msg_c", [
      {
        type: "tool",
        id: "call_grep",
        name: "grep",
        state: { status: "running", input: { pattern: "revenue", path: "src" }, metadata: {} },
        time: { created: 1 },
      },
    ]),
  ])
  const call = (status: "running" | "completed", metadata: object) =>
    Schema.decodeUnknownSync(SessionMessage.Tool)(
      subagent("call_1", status, metadata, { description: "Inspect the code", agent: "explore" }),
    )
  const live = { ...withChild, active: { ses_child: "running" as const } }
  expect(Family.subagent(live, "ses_root", call("running", { sessionID: "ses_child" }))).toEqual({
    child: "ses_child",
    title: "Explore",
    description: "Inspect the code",
    status: "running",
    background: false,
    needsInput: false,
    tools: 1,
    activity: "Grep revenue in src",
  })
  const background = Family.subagent(
    withChild,
    "ses_root",
    call("completed", { sessionID: "ses_child", status: "running" }),
  )
  expect(background.status).toBe("running")
  expect(background.background).toBe(true)
  const asking = { ...withChild, forms: { ses_child: [question("frm_1", "ses_child")] } }
  const waiting = Family.subagent(asking, "ses_root", call("completed", { sessionID: "ses_child" }))
  expect(waiting).toMatchObject({ status: "completed", needsInput: true })
  expect(waiting.activity).toBeUndefined()
})

test("a subagent card tells a denied call from a failed one, and shows the child's retry while it runs", () => {
  const family = sessions([{ id: "ses_root" }, { id: "ses_child", parentID: "ses_root" }])
  const failed = (message: string) =>
    Schema.decodeUnknownSync(SessionMessage.Tool)({
      type: "tool",
      id: "call_1",
      name: "subagent",
      state: { status: "error", input: { description: "Inspect the code" }, error: { type: "tool", message } },
      time: { created: 1 },
    })
  expect(Family.subagent(family, "ses_root", failed("Subagent denied: explore")).status).toBe("denied")
  expect(Family.subagent(family, "ses_root", failed("The model is unreachable")).status).toBe("failed")
  const retrying = transcript(family, "ses_child", [
    Fixture.message({
      id: "msg_c",
      type: "assistant",
      agent: "explore",
      model: Fixture.model,
      content: [],
      retry: { attempt: 2, at: 5, error: { type: "api", message: "Rate limited" } },
      time: { created: 1 },
    }),
  ])
  const running = Schema.decodeUnknownSync(SessionMessage.Tool)(
    subagent("call_1", "running", { sessionID: "ses_child" }, { description: "Inspect the code" }),
  )
  expect(Family.subagent(retrying, "ses_root", running).retry).toBe("Rate limited")
  const done = Schema.decodeUnknownSync(SessionMessage.Tool)(
    subagent("call_1", "completed", { sessionID: "ses_child" }, { description: "Inspect the code" }),
  )
  expect(Family.subagent(retrying, "ses_root", done).retry).toBeUndefined()
})
