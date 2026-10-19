import { describe, expect, test } from "bun:test"
import { Form } from "@ren/schema/form"
import { Permission } from "@ren/schema/permission"
import type { SessionMessage } from "@ren/schema/session-message"
import { Schema } from "effect"
import { ChatState } from "../src/chat-state.js"
import { Family } from "../src/family.js"
import { Hydrate } from "../src/hydrate.js"
import { Fixture } from "./lib/fixture.js"

const sessions = (list: ReadonlyArray<{ readonly id: string; readonly parentID?: string; readonly title?: string }>) =>
  Hydrate.info(
    ChatState.empty,
    list.map((item) => Fixture.session(item.id, item)),
  )

const permission = (id: string, sessionID: string) =>
  Schema.decodeUnknownSync(Permission.Request)({ id, sessionID, action: "webfetch", resources: [] })

const question = (id: string, sessionID: string) =>
  Schema.decodeUnknownSync(Form.Info)({ id, sessionID, title: "Questions", fields: [{ key: "q0", type: "string" }] })

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
  ] as const)("%s", (_name, forms, id) => {
    expect<string | undefined>(Family.form({ ...tree, forms }, "ses_root")?.id).toBe(id)
  })
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
