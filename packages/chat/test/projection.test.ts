import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import { DateTime, Predicate } from "effect"
import { Projection } from "../src/projection.js"
import { TimelineDetail } from "../src/timeline-detail.js"
import { TimelineRow } from "../src/timeline-row.js"

const at = (millis: number) => DateTime.makeUnsafe(millis)

const model = { id: "model", providerID: "provider" }

const user = (id: string, created = 1): SessionMessage.User => ({
  id: SessionMessage.ID.make(id),
  type: "user",
  text: "prompt",
  time: { created: at(created) },
})

const assistant = (
  id: string,
  content: ReadonlyArray<SessionMessage.Content>,
  fields: Partial<Omit<SessionMessage.Assistant, "id" | "type" | "content">> = {},
): SessionMessage.Assistant => ({
  id: SessionMessage.ID.make(id),
  type: "assistant",
  agent: "build",
  model,
  content,
  time: { created: at(2), completed: at(3) },
  ...fields,
})

const notice = (id: string, created = 10): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.make(id),
  type: "synthetic",
  text: "done",
  description: "Background work completed",
  time: { created: at(created) },
})

const modelSwitched = (id: string, created = 4): SessionMessage.ModelSwitched => ({
  id: SessionMessage.ID.make(id),
  type: "model-switched",
  model: { id: "next", providerID: "provider" },
  time: { created: at(created) },
})

const compaction = (id: string, created = 11): SessionMessage.CompactionCompleted => ({
  id: SessionMessage.ID.make(id),
  type: "compaction",
  status: "completed",
  reason: "auto",
  summary: "summary",
  recent: "recent",
  time: { created: at(created) },
})

const idle = (id: string, error: SessionMessage.Idle["error"] & {}, created = 4): SessionMessage.Idle => ({
  id: SessionMessage.ID.make(id),
  type: "idle",
  outcome: "failed",
  error,
  time: { created: at(created) },
})

const tool = (
  id: string,
  name: string,
  status: SessionMessage.ToolState["status"],
  input: typeof SessionMessage.Json.Type = {},
  metadata?: typeof SessionMessage.Json.Type,
  output = "Complete",
): SessionMessage.Tool => {
  const states: Record<SessionMessage.ToolState["status"], SessionMessage.ToolState> = {
    streaming: { status: "streaming", input: JSON.stringify(input) },
    running: { status: "running", input, metadata: metadata ?? {} },
    completed: {
      status: "completed",
      input,
      content: [{ type: "text", text: output }],
      ...(metadata && { metadata }),
    },
    error: {
      status: "error",
      input,
      error: { type: "ToolExecutionError", message: `${name} failed visibly` },
      ...(metadata && { metadata }),
    },
  }
  return {
    type: "tool",
    id,
    name,
    state: states[status],
    time: {
      created: at(1),
      ...(status !== "streaming" && { ran: at(2) }),
      ...((status === "completed" || status === "error") && { completed: at(3) }),
    },
  }
}

const story = (
  content: ReadonlyArray<SessionMessage.Content>,
  busy = false,
  fields: Partial<Omit<SessionMessage.Assistant, "id" | "type" | "content">> = {},
) => [
  user("msg_user_thinking"),
  assistant("msg_tool_projection_assistant", content, { ...(busy && { time: { created: at(2) } }), ...fields }),
]

const tags = (rows: ReadonlyArray<TimelineRow.Row>) => rows.map((row) => row._tag)

const keys = (rows: ReadonlyArray<TimelineRow.Row>) => rows.map(TimelineRow.key)

const groups = (rows: ReadonlyArray<TimelineRow.Row>) =>
  rows.flatMap((row) => (Predicate.isTagged(row, "AssistantPart") ? [row.group] : []))

const groupTypes = (rows: ReadonlyArray<TimelineRow.Row>) => groups(rows).map((group) => group.type)

describe("current session timeline rows", () => {
  test("derives turns and tagged rows from chronological current messages", () => {
    const result = Projection.project({
      messages: [
        user("msg_1", 1),
        assistant("msg_2", [{ type: "text", text: "answer" }]),
        user("msg_3", 4),
        assistant("msg_4", [{ type: "reasoning", text: "working" }], { time: { created: at(5) } }),
      ],
      busy: true,
      reasoning: "full",
    })

    expect(result.activeMessageID).toBe("msg_3")
    expect(keys(result.rows)).toEqual([
      "user-message:msg_1",
      "assistant-part:part:part:msg_2:msg_2:text:0",
      "turn-gap:msg_3",
      "user-message:msg_3",
      "thinking:msg_3",
    ])
  })

  test("renders a current shell message as a standalone turn", () => {
    const result = Projection.project({
      messages: [
        {
          id: SessionMessage.ID.make("msg_shell"),
          type: "shell",
          shellID: "shell_1",
          command: "pwd",
          status: "exited",
          exit: 0,
          output: { output: "/repo", cursor: 5, size: 5, truncated: false },
          time: { created: at(1), completed: at(2) },
        },
        {
          id: SessionMessage.ID.make("msg_shell_completion"),
          type: "synthetic",
          text: "User shell pwd completed: /repo",
          time: { created: at(3) },
        },
      ],
      busy: false,
      reasoning: "full",
    })

    expect(result.activeMessageID).toBe("msg_shell")
    expect(keys(result.rows)).toEqual(["shell:msg_shell"])
  })

  test("keeps assistant content when no user root is available", () => {
    const result = Projection.project({
      messages: [notice("msg_notice", 1), assistant("msg_assistant", [{ type: "text", text: "result" }])],
      busy: false,
      reasoning: "full",
    })

    expect(result.activeMessageID).toBe("msg_assistant")
    expect(keys(result.rows)).toEqual([
      "notice:msg_notice",
      "assistant-part:part:part:msg_assistant:msg_assistant:text:0",
    ])
  })

  test("keeps CLI notice messages between the assistant steps they surround", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        { id: SessionMessage.ID.make("msg_agent"), type: "agent-switched", agent: "explore", time: { created: at(2) } },
        assistant("msg_assistant_1", [{ type: "text", text: "started" }], { agent: "explore" }),
        {
          id: SessionMessage.ID.make("msg_background"),
          type: "synthetic",
          text: "result",
          description: "Search code",
          time: { created: at(5) },
        },
        modelSwitched("msg_model", 6),
        assistant("msg_assistant_2", [{ type: "text", text: "finished" }], { agent: "explore" }),
        {
          id: SessionMessage.ID.make("msg_restart"),
          type: "synthetic",
          text: "continue",
          description: "Continuing after restart",
          time: { created: at(9) },
        },
        {
          id: SessionMessage.ID.make("msg_skill"),
          type: "skill",
          skill: "review",
          name: "Review",
          text: "instructions",
          time: { created: at(10) },
        },
        compaction("msg_compaction"),
      ],
      busy: false,
      reasoning: "full",
    })

    expect(keys(result.rows)).toEqual([
      "user-message:msg_user",
      "notice:msg_agent",
      "assistant-part:part:part:msg_assistant_1:msg_assistant_1:text:0",
      "notice:msg_background",
      "notice:msg_model",
      "assistant-part:part:part:msg_assistant_2:msg_assistant_2:text:0",
      "notice:msg_restart",
      "notice:msg_skill",
      "notice:msg_compaction",
    ])
  })

  test("does not infer thinking from an optimistic busy turn", () => {
    const result = Projection.project({ messages: [user("msg_z", 1), user("msg_a", 2)], busy: true, reasoning: "full" })

    expect(result.activeMessageID).toBe("msg_a")
    expect(keys(result.rows)).toEqual(["user-message:msg_z", "turn-gap:msg_a", "user-message:msg_a"])
  })

  test("does not infer thinking above a queued user message", () => {
    const result = Projection.project({
      messages: [user("msg_active", 1), user("msg_queued", 2)],
      busy: true,
      reasoning: "full",
      pendingInputIDs: new Set(["msg_queued"]),
    })

    expect(result.activeMessageID).toBe("msg_active")
    expect(keys(result.rows)).toEqual(["user-message:msg_active", "turn-gap:msg_queued", "user-message:msg_queued"])
  })

  test("suppresses thinking while a subagent is delegating or running", () => {
    expect(
      (["streaming", "running"] as const).map((status) =>
        tags(
          Projection.project({
            messages: [
              user("msg_user"),
              assistant("msg_assistant", [tool("tool_subagent", "subagent", status, { description: "Inspect code" })], {
                time: { created: at(2) },
              }),
            ],
            busy: true,
            reasoning: "full",
          }).rows,
        ),
      ),
    ).toEqual([
      ["UserMessage", "AssistantPart"],
      ["UserMessage", "AssistantPart"],
    ])
  })

  test("renders retry state from the current assistant message", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant("msg_assistant", [], {
          retry: { attempt: 2, at: at(10), error: { type: "ProviderError", message: "rate limited" } },
          time: { created: at(2) },
        }),
      ],
      busy: true,
      reasoning: "full",
    })

    expect(tags(result.rows)).toEqual(["UserMessage", "Retry"])
  })

  test.each(["hidden", "compact", "full"] as const)("only shows active reasoning in %s mode", (reasoning) => {
    const active: SessionMessage.Reasoning = { type: "reasoning", text: "## Current thought", time: { created: at(2) } }

    const cases: ReadonlyArray<{
      readonly content: ReadonlyArray<SessionMessage.Content>
      readonly thinking: boolean
    }> = [
      { content: [], thinking: false },
      { content: [active], thinking: true },
      { content: [{ type: "reasoning", text: "", time: { created: at(2) } }], thinking: true },
      {
        content: [{ type: "reasoning", text: "## Current thought", time: { created: at(2), completed: at(3) } }],
        thinking: false,
      },
      { content: [active, { type: "text", text: "Answer" }], thinking: false },
      ...(["streaming", "running", "completed", "error"] as const).flatMap((status) =>
        ["shell", "read", "subagent", "question"].map((name) => ({
          content: [active, tool("tool", name, status)],
          thinking: false,
        })),
      ),
    ]

    expect(
      cases.map((profile) =>
        Projection.project({ messages: story(profile.content, true), busy: true, reasoning }).rows.some((row) =>
          Predicate.isTagged(row, "Thinking"),
        ),
      ),
    ).toEqual(cases.map((profile) => reasoning !== "hidden" && profile.thinking))
  })

  test("omits a grouped reasoning-only row while busy until other content or completion", () => {
    const thought: SessionMessage.Reasoning = {
      type: "reasoning",
      text: "Thinking",
      time: { created: at(1), completed: at(2) },
    }

    const rows = (content: ReadonlyArray<SessionMessage.Content>, session: { readonly busy: boolean }) =>
      Projection.project({
        messages: story(content, session.busy),
        busy: session.busy,
        reasoning: "compact",
        detail: TimelineDetail.presets[2].value,
      }).rows

    expect(tags(rows([{ type: "reasoning", text: "Thinking", time: { created: at(1) } }], { busy: true }))).toEqual([
      "UserMessage",
    ])
    expect(tags(rows([thought], { busy: true }))).toEqual(["UserMessage"])
    expect(tags(rows([thought, { type: "text", text: "" }], { busy: true }))).toEqual(["UserMessage"])
    expect(tags(rows([thought, { type: "text", text: "Answer" }], { busy: true }))).toEqual([
      "UserMessage",
      "AssistantPart",
      "AssistantPart",
    ])
    expect(
      tags(rows([thought, tool("read", "read", "running", { filePath: "package.json" })], { busy: true })),
    ).toEqual(["UserMessage", "AssistantPart"])
    expect(tags(rows([thought], { busy: false }))).toEqual(["UserMessage", "AssistantPart"])

    expect(
      tags(
        Projection.project({
          messages: story([thought], true, { error: { type: "provider.error", message: "Failed" } }),
          busy: true,
          reasoning: "compact",
          detail: TimelineDetail.presets[2].value,
        }).rows,
      ),
    ).toEqual(["UserMessage", "AssistantPart", "Error"])

    expect(
      tags(
        Projection.project({
          messages: story([thought], true, { error: { type: "Interrupted", message: "Stopped" } }),
          busy: true,
          reasoning: "compact",
          detail: { ...TimelineDetail.presets[2].value, notices: { placement: "hidden" } },
        }).rows,
      ),
    ).toEqual(["UserMessage", "AssistantPart"])
  })

  test("stops thinking on idle, message completion, errors and retries", () => {
    const content: ReadonlyArray<SessionMessage.Content> = [{ type: "reasoning", text: "Current thought" }]
    expect(tags(Projection.project({ messages: story(content, true), busy: false, reasoning: "full" }).rows)).toEqual([
      "UserMessage",
      "AssistantPart",
    ])

    const endings: ReadonlyArray<Partial<SessionMessage.Assistant>> = [
      { time: { created: at(1), completed: at(2) } },
      { error: { type: "Interrupted", message: "Stopped" } },
      { retry: { attempt: 1, at: at(10), error: { type: "ProviderError", message: "Retry" } } },
    ]

    expect(
      endings.map((ending) =>
        Projection.project({ messages: story(content, true, ending), busy: true, reasoning: "full" }).rows.some((row) =>
          Predicate.isTagged(row, "Thinking"),
        ),
      ),
    ).toEqual([false, false, false])
  })

  test("uses the latest reasoning part and groups earlier thoughts with tools", () => {
    const result = Projection.project({
      messages: story(
        [
          { type: "reasoning", text: "Old thought", time: { created: at(1), completed: at(2) } },
          tool("read", "read", "completed"),
          { type: "reasoning", text: "New thought", time: { created: at(3) } },
        ],
        true,
      ),
      busy: true,
      reasoning: "full",
    })

    expect(tags(result.rows)).toEqual(["UserMessage", "AssistantPart", "Thinking"])
    expect(result.rows[1]).toMatchObject({
      group: { type: "context", refs: [{ partID: "msg_tool_projection_assistant:reasoning:0" }, { partID: "read" }] },
    })
    expect(result.rows[2]).toMatchObject({ ref: { partID: "msg_tool_projection_assistant:reasoning:1" } })
  })

  test("keeps actual thinking with the active prompt above an undelivered prompt", () => {
    const result = Projection.project({
      messages: [...story([{ type: "reasoning", text: "Active thought" }], true), user("msg_queued", 10)],
      busy: true,
      reasoning: "full",
      pendingInputIDs: new Set(["msg_queued"]),
    })

    expect(tags(result.rows)).toEqual(["UserMessage", "Thinking", "TurnGap", "UserMessage"])
    expect(result.rows[1]?.userMessageID).toBe("msg_user_thinking")
  })

  test("places a queued compaction after the active turn and before undelivered prompts", () => {
    const result = Projection.project({
      messages: [...story([{ type: "text", text: "Working" }], true), user("msg_queued", 10)],
      busy: true,
      reasoning: "full",
      pendingInputIDs: new Set(["msg_queued"]),
      queuedCompactionIDs: ["inb_compact"],
    })

    expect(tags(result.rows)).toEqual(["UserMessage", "AssistantPart", "CompactionQueued", "TurnGap", "UserMessage"])
    expect(result.rows[2]?.userMessageID).toBe("msg_user_thinking")
  })

  test("places a queued compaction ahead of a pending notice, which the server delivers after it", () => {
    const result = Projection.project({
      messages: [...story([{ type: "text", text: "Working" }], true), notice("msg_notice")],
      busy: true,
      reasoning: "full",
      pendingInputIDs: new Set(["msg_notice"]),
      queuedCompactionIDs: ["inb_compact"],
    })

    expect(tags(result.rows)).toEqual(["UserMessage", "AssistantPart", "CompactionQueued", "Notice"])
  })

  test("keeps live thinking above a notice that arrives while it streams", () => {
    const result = Projection.project({
      messages: [...story([{ type: "reasoning", text: "Active thought" }], true), notice("msg_notice")],
      busy: true,
      reasoning: "full",
      detail: TimelineDetail.presets[0].value,
    })

    expect(tags(result.rows)).toEqual(["UserMessage", "Thinking", "Notice"])
  })

  test.each(["shell", "execute", "subagent"])("does not hide active %s behind a preceding thought", (name) => {
    const result = Projection.project({
      messages: story(
        [
          { type: "reasoning", text: "Finished thought", time: { created: at(1), completed: at(2) } },
          tool("active", name, "running"),
        ],
        true,
      ),
      busy: true,
      reasoning: "full",
    })

    expect(groupTypes(result.rows)).toEqual(["part", "part"])
  })

  test("keeps divider notices outside grouped context rows", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant("msg_assistant", [tool("tool_read", "read", "completed")]),
        modelSwitched("msg_model", 4),
        {
          id: SessionMessage.ID.make("msg_skill"),
          type: "skill",
          skill: "review",
          name: "Review",
          text: "instructions",
          time: { created: at(5) },
        },
      ],
      busy: false,
      reasoning: "hidden",
      detail: TimelineDetail.presets[2].value,
    })

    expect(keys(result.rows)).toEqual([
      "user-message:msg_user",
      "assistant-part:context:context:msg_assistant:tool_read",
      "notice:msg_model",
      "assistant-part:context:message:msg_skill",
    ])
  })

  test("keeps assistant errors and retries before later notices", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant("msg_blocked", [{ type: "text", text: "partial" }], {
          error: { type: "provider.content-filter", message: "Provider blocked the response" },
        }),
        modelSwitched("msg_model", 4),
      ],
      busy: false,
      reasoning: "full",
    })

    expect(tags(result.rows)).toEqual(["UserMessage", "AssistantPart", "Error", "Notice"])

    const retry = Projection.project({
      messages: [
        user("msg_user"),
        assistant("msg_retry", [], {
          error: { type: "ProviderError", message: "rate limited" },
          retry: { attempt: 2, at: at(10), error: { type: "ProviderError", message: "rate limited" } },
          time: { created: at(2) },
        }),
        modelSwitched("msg_model", 3),
      ],
      busy: false,
      reasoning: "full",
    })

    expect(tags(retry.rows)).toEqual(["UserMessage", "Retry", "Notice"])
  })

  test("suppresses an earlier error when the turn recovers across a notice", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant("msg_failed", [], { error: { type: "ProviderError", message: "temporary failure" } }),
        modelSwitched("msg_model", 4),
        assistant("msg_recovery", [{ type: "text", text: "recovered" }], {
          model: { id: "next", providerID: "provider" },
          time: { created: at(5), completed: at(6) },
        }),
      ],
      busy: false,
      reasoning: "full",
    })

    expect(tags(result.rows)).toEqual(["UserMessage", "Notice", "AssistantPart"])
  })

  test("does not render the retry error twice", () => {
    const error = { type: "ProviderError", message: "The provider response ended unexpectedly." }

    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant("msg_assistant", [], {
          error,
          retry: { attempt: 2, at: at(10), error },
          time: { created: at(2) },
        }),
      ],
      busy: false,
      reasoning: "full",
    })

    expect(tags(result.rows)).toEqual(["UserMessage", "Retry"])
  })

  test("removes a failed assistant error when the turn continues streaming", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant("msg_failed", [], { error: { type: "ProviderError", message: "temporary failure" } }),
        assistant("msg_recovery", [{ type: "text", text: "streaming again" }], { time: { created: at(4) } }),
      ],
      busy: true,
      reasoning: "full",
    })

    expect(tags(result.rows)).toEqual(["UserMessage", "AssistantPart"])
  })

  test("keeps content IDs and groups adjacent context tools", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant(
          "msg_assistant",
          [
            { type: "text", text: " " },
            { type: "reasoning", text: "hidden" },
            tool("tool_read", "read", "running"),
            tool("tool_grep", "grep", "running"),
            tool("tool_todo", "todowrite", "running"),
            tool("tool_question", "question", "streaming"),
            { type: "text", text: "visible" },
          ],
          { time: { created: at(2) } },
        ),
      ],
      busy: false,
      reasoning: "hidden",
    })

    expect(groups(result.rows)).toEqual([
      {
        type: "context",
        key: "context:msg_assistant:tool_read",
        refs: [
          { messageID: "msg_assistant", partID: "tool_read" },
          { messageID: "msg_assistant", partID: "tool_grep" },
        ],
      },
      {
        type: "part",
        key: "part:msg_assistant:msg_assistant:text:1",
        ref: { messageID: "msg_assistant", partID: "msg_assistant:text:1" },
      },
    ])
  })

  test("shows a reply in the channel thread as its own row between grouped tools, and groups a failed one", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant(
          "msg_assistant",
          [
            tool("tool_read", "read", "completed"),
            tool(
              "tool_reply",
              "slack_reply_to_current_thread",
              "completed",
              { text: "Rolled back." },
              undefined,
              '{"provider":"slack","place":"eng"}',
            ),
            tool("tool_grep", "grep", "completed"),
            tool("tool_failed", "slack_reply_to_current_thread", "error", { text: "Again." }),
          ],
          { time: { created: at(2) } },
        ),
      ],
      busy: false,
      reasoning: "hidden",
    })

    expect(groups(result.rows).map((group) => [group.type, group.key])).toEqual([
      ["context", "context:msg_assistant:tool_read"],
      ["part", "part:msg_assistant:tool_reply"],
      ["context", "context:msg_assistant:tool_grep"],
    ])
  })

  test("keeps reads that load files outside context groups", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant(
          "msg_assistant",
          [
            tool(
              "tool_read",
              "read",
              "completed",
              { path: "packages/cli/AGENTS.md" },
              { loaded: ["packages/cli/AGENTS.md"] },
            ),
            tool("tool_grep", "grep", "running"),
          ],
          { time: { created: at(2) } },
        ),
      ],
      busy: false,
      reasoning: "hidden",
    })

    expect(groups(result.rows)).toEqual([
      {
        type: "part",
        key: "part:msg_assistant:tool_read",
        ref: { messageID: "msg_assistant", partID: "tool_read" },
      },
      {
        type: "context",
        key: "context:msg_assistant:tool_grep",
        refs: [{ messageID: "msg_assistant", partID: "tool_grep" }],
      },
    ])
  })

  test("keeps context row keys unique when tool IDs repeat across assistant messages", () => {
    const step = (id: string, name: string) =>
      assistant(id, [tool("tool_0", name, "running")], { time: { created: at(2) } })

    const result = Projection.project({
      messages: [
        user("msg_user"),
        step("msg_assistant_1", "read"),
        step("msg_assistant_2", "execute"),
        step("msg_assistant_3", "grep"),
      ],
      busy: false,
      reasoning: "hidden",
      shellToolDefaultOpen: true,
    })

    expect(keys(result.rows)).toEqual([
      "user-message:msg_user",
      "assistant-part:context:context:msg_assistant_1:tool_0",
      "assistant-part:part:part:msg_assistant_2:tool_0",
      "assistant-part:context:context:msg_assistant_3:tool_0",
    ])
  })

  test("groups adjacent successful patches and leaves failed patches separate", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant("msg_assistant", [
          tool("tool_patch_1", "patch", "completed", {}, { files: [] }),
          tool("tool_patch_2", "patch", "running", {}, { files: [] }),
          tool("tool_patch_failed", "patch", "error", {}, { files: [] }),
          tool("tool_patch_3", "patch", "completed", {}, { files: [] }),
          tool("tool_edit_1", "edit", "running", {}, { files: [] }),
          tool("tool_edit_2", "edit", "running", {}, { files: [] }),
          tool("tool_write_1", "write", "running", {}, { files: [] }),
        ]),
      ],
      busy: false,
      reasoning: "hidden",
      editToolDefaultOpen: true,
    })

    expect(groups(result.rows)).toEqual([
      {
        type: "file",
        key: "part:msg_assistant:tool_patch_1",
        refs: [
          { messageID: "msg_assistant", partID: "tool_patch_1" },
          { messageID: "msg_assistant", partID: "tool_patch_2" },
        ],
      },
      {
        type: "part",
        key: "part:msg_assistant:tool_patch_failed",
        ref: { messageID: "msg_assistant", partID: "tool_patch_failed" },
      },
      {
        type: "file",
        key: "part:msg_assistant:tool_patch_3",
        refs: [
          { messageID: "msg_assistant", partID: "tool_patch_3" },
          { messageID: "msg_assistant", partID: "tool_edit_1" },
          { messageID: "msg_assistant", partID: "tool_edit_2" },
          { messageID: "msg_assistant", partID: "tool_write_1" },
        ],
      },
    ])
  })

  test("groups every consecutive collapsed tool in chronological order", () => {
    const result = groups(
      Projection.project({
        messages: [
          user("msg_user"),
          assistant(
            "msg_assistant",
            [
              ...["shell", "subagent", "patch", "shell", "edit", "write", "grep"].map((name, index) =>
                tool(`tool_${index}`, name, "completed", {}, {}),
              ),
              { type: "text", text: "finished" },
              tool("tool_after_text", "shell", "completed", {}, {}),
            ],
            { time: { created: at(2) } },
          ),
        ],
        busy: false,
        reasoning: "hidden",
      }).rows,
    )

    expect(result.map((group) => group.type)).toEqual(["context", "part", "context"])
    expect(result[0]?.type === "context" ? result[0].refs.map((ref) => ref.partID) : []).toEqual([
      "tool_0",
      "tool_1",
      "tool_2",
      "tool_3",
      "tool_4",
      "tool_5",
      "tool_6",
    ])
    expect(result[2]?.type === "context" ? result[2].refs.map((ref) => ref.partID) : []).toEqual(["tool_after_text"])
  })

  test.each([
    { shell: false, edit: false, types: ["context"] },
    { shell: true, edit: false, types: ["part", "context"] },
    { shell: false, edit: true, types: ["context", "file", "context"] },
    { shell: true, edit: true, types: ["part", "file", "context"] },
  ])("keeps tools expanded by settings outside collapsed groups ($shell, $edit)", (profile) => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant(
          "msg_assistant",
          ["shell", "edit", "write", "patch", "read"].map((name) => tool(`tool_${name}`, name, "completed", {}, {})),
          { time: { created: at(2) } },
        ),
      ],
      busy: false,
      reasoning: "hidden",
      shellToolDefaultOpen: profile.shell,
      editToolDefaultOpen: profile.edit,
    })

    expect(groupTypes(result.rows)).toEqual([...profile.types])
  })

  test("merges adjacent separate reads into one read row split by other parts", () => {
    const result = Projection.project({
      messages: story([
        tool("read_1", "read", "completed", { path: "src/a.ts" }),
        tool("read_2", "read", "running", { path: "src/b.ts", limit: 120 }),
        { type: "reasoning", text: "Keep reading." },
        tool("read_3", "read", "completed", { path: "src/c.ts" }),
        tool("read_image", "read", "completed", { path: "src/logo.png" }),
        tool("read_failed", "read", "error", { path: "src/missing.ts" }),
        tool("read_4", "read", "completed", { path: "src/d.ts" }),
        tool("read_5", "read", "completed", { path: "src/e.ts" }),
        tool("glob", "glob", "completed", { pattern: "*.ts" }),
        tool("read_6", "read", "completed", { path: "src/f.ts" }),
      ]),
      busy: false,
      reasoning: "full",
      detail: TimelineDetail.presets[0].value,
    })

    expect(
      groups(result.rows).map((group) => [
        group.type,
        (group.type === "part" ? [group.ref] : group.refs).map((ref) => ref.partID),
      ]),
    ).toEqual([
      ["read", ["read_1", "read_2"]],
      ["part", ["msg_tool_projection_assistant:reasoning:0"]],
      ["read", ["read_3"]],
      ["part", ["read_image"]],
      ["part", ["read_failed"]],
      ["read", ["read_4", "read_5"]],
      ["part", ["glob"]],
      ["read", ["read_6"]],
    ])
  })

  test.each(["shell", "execute", "subagent"])("keeps %s in an existing group throughout execution", (name) => {
    const earlier = story([tool("earlier", "read", "completed")])
    const initial = Projection.project({ messages: earlier, busy: true, reasoning: "hidden" })

    const phases: ReadonlyArray<{
      readonly status: SessionMessage.ToolState["status"]
      readonly metadata?: typeof SessionMessage.Json.Type
    }> = [
      { status: "streaming" },
      { status: "running" },
      { status: "completed", metadata: { status: "running" } },
      { status: "completed" },
      { status: "error" },
    ]

    phases.reduce<ReadonlyArray<TimelineRow.Row>>((previous, phase, index) => {
      const result = Projection.project({
        messages: [...earlier, assistant("msg_next_step", [tool("active", name, phase.status, {}, phase.metadata)])],
        busy: true,
        reasoning: "hidden",
        previous,
      })

      const parts = result.rows.filter((row) => Predicate.isTagged(row, "AssistantPart"))
      expect(parts).toHaveLength(1)
      expect(parts[0]?.group).toMatchObject({
        type: "context",
        refs: [
          { messageID: "msg_tool_projection_assistant", partID: "earlier" },
          { messageID: "msg_next_step", partID: "active" },
        ],
      })
      expect(parts[0] && TimelineRow.key(parts[0])).toBe(initial.rows[1] && TimelineRow.key(initial.rows[1]))

      if (index > 0) expect(parts[0]).toBe(previous.find((row) => Predicate.isTagged(row, "AssistantPart")))

      return result.rows
    }, initial.rows)
  })

  test.each([
    { name: "shell", expanded: true, types: ["context", "part"] },
    { name: "execute", expanded: true, types: ["context", "part"] },
    { name: "subagent", expanded: true, types: ["context"] },
    { name: "shell", separator: "text", types: ["context", "part", "part"] },
    { name: "shell", separator: "reasoning", showReasoning: true, types: ["context"] },
    { name: "shell", separator: "reasoning", showReasoning: false, types: ["context"] },
  ] as const)("respects active tool grouping boundaries: %j", (profile) => {
    const separator = "separator" in profile ? profile.separator : undefined

    const result = Projection.project({
      messages: story([
        tool("earlier", "read", "completed"),
        ...(separator ? [{ type: separator, text: "Visible boundary" }] : []),
        tool("active", profile.name, "running"),
      ]),
      busy: true,
      reasoning: "showReasoning" in profile && profile.showReasoning ? "full" : "hidden",
      shellToolDefaultOpen: "expanded" in profile && profile.expanded,
    })

    expect(groupTypes(result.rows)).toEqual([...profile.types])
  })

  test("keeps active and background work standalone when no group precedes them", () => {
    const result = Projection.project({
      messages: [
        user("msg_user"),
        assistant(
          "msg_assistant",
          [
            tool("tool_running_shell", "shell", "running"),
            tool("tool_background_agent", "subagent", "completed", {}, { status: "running" }),
            tool("tool_completed_shell", "shell", "completed", {}, {}),
          ],
          { time: { created: at(2) } },
        ),
      ],
      busy: true,
      reasoning: "hidden",
    })

    expect(groupTypes(result.rows)).toEqual(["part", "part", "context"])
  })

  test("keeps failed calls inside a collapsed mixed-tool stack", () => {
    const messages = [
      user("msg_user"),
      assistant("msg_assistant", [
        tool("tool_glob_failed", "glob", "error", { pattern: "*.ts" }, {}),
        tool("tool_grep_failed", "grep", "error", { pattern: "value" }, {}),
        tool("tool_shell_failed", "shell", "error", { command: "exit 1" }, {}),
      ]),
    ]

    expect(groups(Projection.project({ messages, busy: false, reasoning: "hidden" }).rows)).toEqual([
      {
        type: "context",
        key: "context:msg_assistant:tool_glob_failed",
        refs: [
          { messageID: "msg_assistant", partID: "tool_glob_failed" },
          { messageID: "msg_assistant", partID: "tool_grep_failed" },
          { messageID: "msg_assistant", partID: "tool_shell_failed" },
        ],
      },
    ])
    expect(
      groupTypes(Projection.project({ messages, busy: false, reasoning: "hidden", shellToolDefaultOpen: true }).rows),
    ).toEqual(["context", "part"])
  })

  test("places a divider after interrupted output unless the turn compacts", () => {
    const prompt = user("msg_user")
    const interrupted = assistant("msg_interrupted", [{ type: "text", text: "before" }], {
      error: { type: "ExecutionInterrupted", message: "stopped" },
    })
    const continued = assistant("msg_continued", [{ type: "text", text: "after" }], {
      time: { created: at(4), completed: at(5) },
    })

    expect(
      tags(Projection.project({ messages: [prompt, interrupted, continued], busy: false, reasoning: "full" }).rows),
    ).toEqual(["UserMessage", "AssistantPart", "TurnDivider", "AssistantPart"])

    expect(
      tags(
        Projection.project({
          messages: [prompt, interrupted, compaction("msg_compaction", 4), continued],
          busy: false,
          reasoning: "full",
        }).rows,
      ),
    ).toEqual(["UserMessage", "AssistantPart", "Notice", "AssistantPart"])
  })

  test("surfaces failed idle errors when no assistant step owns the failure", () => {
    const preStep = Projection.project({
      messages: [
        user("msg_user"),
        idle("msg_idle", { type: "provider.no-route", message: "Model unavailable: opencode/gpt-5.2" }, 2),
        modelSwitched("msg_model", 3),
      ],
      busy: false,
      reasoning: "full",
    }).rows
    expect(tags(preStep)).toEqual(["UserMessage", "Error", "Notice"])
    expect(preStep[1]).toEqual(
      new TimelineRow.Error({
        userMessageID: "msg_user",
        kind: "provider.no-route",
        text: "Model unavailable: opencode/gpt-5.2",
      }),
    )

    expect(
      tags(
        Projection.project({
          messages: [
            user("msg_user"),
            assistant("msg_assistant", [tool("tool_read", "read", "completed")], { finish: "tool-calls" }),
            idle("msg_idle", { type: "unknown", message: "Failed to execute statement" }),
          ],
          busy: false,
          reasoning: "full",
        }).rows,
      ),
    ).toEqual(["UserMessage", "AssistantPart", "Error"])

    const denied = { type: "provider.auth", message: "Your organization does not have access to this model." }

    expect(
      tags(
        Projection.project({
          messages: [
            user("msg_user"),
            assistant("msg_assistant", [], { finish: "error", error: denied }),
            idle("msg_idle", denied),
          ],
          busy: false,
          reasoning: "full",
        }).rows,
      ),
    ).toEqual(["UserMessage", "Error"])

    expect(
      Projection.project({
        messages: [
          user("msg_user"),
          assistant("msg_assistant", [], { error: { type: "aborted", message: "Step interrupted" } }),
          idle("msg_idle", {
            type: "aborted",
            message: "Execution was interrupted repeatedly and will not be resumed automatically.",
          }),
        ],
        busy: false,
        reasoning: "full",
      }).rows.at(-1),
    ).toEqual(
      new TimelineRow.Error({
        userMessageID: "msg_user",
        kind: "aborted",
        text: "Execution was interrupted repeatedly and will not be resumed automatically.",
      }),
    )
  })
})

const context = (
  key: string,
  partIDs: ReadonlyArray<string>,
  identity: { readonly userMessageID?: string; readonly messageID?: string } = {},
) =>
  new TimelineRow.AssistantPart({
    userMessageID: identity.userMessageID ?? "user-1",
    group: {
      key,
      type: "context",
      refs: partIDs.map((partID) => ({ messageID: identity.messageID ?? "assistant-1", partID })),
    },
    previousAssistantPart: false,
  })

const patch = (key: string, partIDs: ReadonlyArray<string>) =>
  new TimelineRow.AssistantPart({
    userMessageID: "user-1",
    group: { key, type: "file", refs: partIDs.map((partID) => ({ messageID: "assistant-1", partID })) },
    previousAssistantPart: false,
  })

const part = (key: string, partID: string) =>
  new TimelineRow.AssistantPart({
    userMessageID: "user-1",
    group: { key, type: "part", ref: { messageID: "assistant-1", partID } },
    previousAssistantPart: false,
  })

describe("Timeline.resolveContent", () => {
  test("resolves interleaved ordinals and current store references", () => {
    const message = assistant("msg_assistant", [
      { type: "text", text: "" },
      { type: "reasoning", text: "", time: { created: at(0) } },
      tool("read", "read", "running"),
      { type: "text", text: "answer" },
      { type: "reasoning", text: "thought", time: { created: at(0) } },
    ])

    expect(Projection.resolveContent(message, "msg_assistant:text:0")).toBe(message.content[0])
    expect(Projection.resolveContent(message, "msg_assistant:reasoning:0")).toBe(message.content[1])
    expect(Projection.resolveContent(message, "read")).toBe(message.content[2])
    expect(Projection.resolveContent(message, "msg_assistant:text:1")).toBe(message.content[3])
    expect(Projection.resolveContent(message, "msg_assistant:reasoning:1")).toBe(message.content[4])

    const replaced = assistant("msg_assistant", [
      { type: "text", text: "replacement" },
      tool("replacement-tool", "read", "running"),
    ])
    expect(Projection.resolveContent(replaced, "msg_assistant:text:0")).toBe(replaced.content[0])
    expect(Projection.resolveContent(replaced, "replacement-tool")).toBe(replaced.content[1])
    expect(Projection.resolveContent(replaced, "read")).toBeUndefined()
    expect(Projection.resolveContent(replaced, "msg_assistant:text:1")).toBeUndefined()
  })

  test("stops reading as soon as the part is found", () => {
    const message = assistant("msg_assistant", [
      tool("first", "read", "running"),
      {
        get type(): "text" {
          throw new Error("read past the matching part")
        },
        text: "later",
      },
    ])

    expect(Projection.resolveContent(message, "first")).toBe(message.content[0])
  })
})

describe("reuseTimelineRows", () => {
  test.each([
    {
      name: "reuses an unchanged context group",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:a", ["a", "b"])],
      expected: ["assistant-part:context:context:a"],
      reused: true,
    },
    {
      name: "preserves the group key when a member is appended",
      previous: [context("context:a", ["a"])],
      rows: [context("context:a", ["a", "b"])],
      expected: ["assistant-part:context:context:a"],
      reused: false,
    },
    {
      name: "preserves a patch group key when a member is appended",
      previous: [patch("patch:a", ["a"])],
      rows: [patch("patch:a", ["a", "b"])],
      expected: ["assistant-part:file:patch:a"],
      reused: false,
    },
    {
      name: "preserves the group key when the first member is removed",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:b", ["b"])],
      expected: ["assistant-part:context:context:a"],
      reused: false,
    },
    {
      name: "lets only the natural owner retain an old key after a split",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:a", ["a"]), context("context:b", ["b"])],
      expected: ["assistant-part:context:context:a", "assistant-part:context:context:b"],
      reused: false,
    },
    {
      name: "preserves the file group identity when its first member becomes standalone",
      previous: [patch("part:a", ["a", "b"])],
      rows: [part("part:a", "a"), patch("part:b", ["b"])],
      expected: ["assistant-part:part:part:a", "assistant-part:file:part:a"],
      reused: false,
    },
    {
      name: "preserves the file group identity before a later standalone member",
      previous: [patch("part:a", ["a", "b"])],
      rows: [patch("part:b", ["b"]), part("part:a", "a")],
      expected: ["assistant-part:file:part:a", "assistant-part:part:part:a"],
      reused: false,
    },
    {
      name: "chooses the earliest prior key when groups merge",
      previous: [context("context:a", ["a"]), context("context:b", ["b"])],
      rows: [context("context:b", ["b", "a"])],
      expected: ["assistant-part:context:context:a"],
      reused: false,
    },
    {
      name: "reserves an old key for its natural owner when two new groups compete",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:b", ["b"]), context("context:a", ["a"])],
      expected: ["assistant-part:context:context:b", "assistant-part:context:context:a"],
      reused: false,
    },
    {
      name: "reuses context identity when the same parts move to another user message",
      previous: [context("context:a", ["a", "b"], { userMessageID: "user-1" })],
      rows: [context("context:b", ["b"], { userMessageID: "user-2" })],
      expected: ["assistant-part:context:context:a"],
      reused: false,
    },
    {
      name: "does not reuse context identity across assistant messages",
      previous: [context("context:assistant-1:a", ["a"], { messageID: "assistant-1" })],
      rows: [context("context:assistant-2:a", ["a"], { messageID: "assistant-2" })],
      expected: ["assistant-part:context:context:assistant-2:a"],
      reused: false,
    },
    {
      name: "reuses an unaffected ordinary row",
      previous: [new TimelineRow.UserMessage({ userMessageID: "user-1" })],
      rows: [new TimelineRow.UserMessage({ userMessageID: "user-1" })],
      expected: ["user-message:user-1"],
      reused: true,
    },
    {
      name: "does not create accidental key collisions",
      previous: [context("context:a", ["a", "b", "c"])],
      rows: [context("context:b", ["b"]), context("context:a", ["a"]), context("context:c", ["c"])],
      expected: [
        "assistant-part:context:context:b",
        "assistant-part:context:context:a",
        "assistant-part:context:context:c",
      ],
      reused: false,
    },
  ])("$name", (profile) => {
    const result = Projection.reuse(profile.previous, profile.rows)

    expect(keys(result)).toEqual([...profile.expected])
    expect(new Set(keys(result)).size).toBe(result.length)
    expect(result[0] === profile.previous[0]).toBe(profile.reused)
  })
})

describe("createTimelineProjection", () => {
  test("builds current message, parent, context, and row indexes", () => {
    const selected = { id: "selected", providerID: "provider" } satisfies SessionModel.Ref
    const fast = { id: "assistant", providerID: "provider", variant: "fast" } satisfies SessionModel.Ref

    const messages: ReadonlyArray<SessionMessage.Info> = [
      { id: SessionMessage.ID.make("msg_agent"), type: "agent-switched", agent: "explore", time: { created: at(1) } },
      { id: SessionMessage.ID.make("msg_model"), type: "model-switched", model: selected, time: { created: at(2) } },
      user("msg_user_1", 3),
      assistant("msg_assistant_1", [{ type: "text", text: "answer" }], {
        model: fast,
        time: { created: at(4), completed: at(5) },
      }),
      user("msg_user_2", 6),
    ]

    const context = Projection.userContext(messages)
    const result = Projection.project({ messages, busy: true, reasoning: "full" })
    const parents = Projection.assistantMessagesByParent(messages)
    const indexes = Projection.indexes(result.rows)

    expect(result.activeMessageID).toBe("msg_user_2")
    expect(parents.get("msg_user_1")?.map((message): string => message.id)).toEqual(["msg_assistant_1"])
    expect(parents.has("msg_user_2")).toBe(false)
    expect(context.get("msg_user_1")).toEqual({ agent: "build", model: fast })
    expect(context.get("msg_user_2")).toEqual({ agent: "build", model: fast })
    expect(indexes.messageRowIndex.get("msg_user_1")).toBe(0)
    expect(indexes.messageLastRowIndex.get("msg_user_1")).toBe(3)
    expect(indexes.messageRowIndex.get("msg_user_2")).toBe(4)
    expect(indexes.lastAssistantGroupKey.get("msg_user_1")).toBe("part:msg_assistant_1:msg_assistant_1:text:0")
  })

  test("indexes a leading partial assistant turn under its projected turn ID", () => {
    const messages = [
      assistant("msg_partial_1", [{ type: "text", text: "partial answer" }]),
      assistant("msg_partial_2", [{ type: "text", text: "final answer" }], {
        time: { created: at(4), completed: at(5) },
      }),
    ]

    expect(
      Projection.assistantMessagesByParent(messages)
        .get("msg_partial_1")
        ?.map((message): string => message.id),
    ).toEqual(["msg_partial_1", "msg_partial_2"])
  })

  test("reuses a stable projected row array", () => {
    const messages = [user("msg_user_1"), assistant("msg_assistant_1", [{ type: "text", text: "answer" }])]
    const first = Projection.project({ messages, busy: false, reasoning: "full" })
    const second = Projection.project({ messages, busy: false, reasoning: "full", previous: first.rows })

    expect(second.rows).toBe(first.rows)
    expect(second.rows[0]).toBe(first.rows[0])
    expect(second.rows[1]).toBe(first.rows[1])
  })
})

describe("reasoningHeading", () => {
  test("returns the most recent thinking summary heading as sections stream in", () => {
    const sections = [
      "**Designing Interactive Experience**\nI'm focusing on crafting a fun, tactile, and interactive visual toy.",
      "**Analyzing Reading Recommendations**\nI'm currently dissecting whether Luke Parker should read the *Throne of Glass* series.",
      "**Constructing Reader Tools**\nI'm now building out interactive tools.",
    ]

    expect(Projection.reasoningHeading(sections.slice(0, 1).join("\n\n"))).toBe("Designing Interactive Experience")
    expect(Projection.reasoningHeading(sections.slice(0, 2).join("\n\n"))).toBe("Analyzing Reading Recommendations")
    expect(Projection.reasoningHeading(sections.join("\n\n"))).toBe("Constructing Reader Tools")
  })

  test("keeps the previous heading while the next bold heading is still streaming", () => {
    const text = [
      "**Designing Interactive Experience**\nI'm focusing on crafting a fun, tactile, and interactive visual toy.",
      "**Analyzing Reading",
    ].join("\n\n")

    expect(Projection.reasoningHeading(text)).toBe("Designing Interactive Experience")
  })

  test("returns the latest heading across markdown heading styles and ignores inline bold spans", () => {
    expect(Projection.reasoningHeading("## First step\n\nDetails.\n\n## Second step\n\nMore details.")).toBe(
      "Second step",
    )
    expect(Projection.reasoningHeading("<h2>First step</h2>\n<p>Body</p>\n<h3>Second step</h3>")).toBe("Second step")
    expect(Projection.reasoningHeading("First step\n===\n\nSecond step\n---")).toBe("Second step")
    expect(
      Projection.reasoningHeading("**Designing Interactive Experience**\n\n**Note** that this line ends with **bold**"),
    ).toBe("Designing Interactive Experience")
  })
})
