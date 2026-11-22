import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"
import { TranscriptBlocks } from "../src/transcript-blocks.js"

const tool: SessionMessage.Tool = {
  type: "tool",
  id: "tool_read",
  name: "read",
  state: { status: "completed", input: {}, content: [{ type: "text", text: "" }] },
  time: { created: DateTime.makeUnsafe(1) },
}

const steps = (key: string): TranscriptBlocks.Block => ({
  kind: "steps",
  key,
  turn: "msg_user",
  steps: [{ kind: "tool", key: `${key}:tool`, tool }],
})

const answer = (key: string, text: string, streaming = false): TranscriptBlocks.Block => ({
  kind: "answer",
  key,
  turn: "msg_user",
  text,
  streaming,
})

const kinds = (blocks: ReadonlyArray<TranscriptBlocks.Block>) =>
  blocks.map((block) =>
    block.kind === "steps" ? `steps(${block.steps.map((step) => step.kind).join(",")})` : block.kind,
  )

describe("transcript blocks", () => {
  test("with narration, text followed by a tool call folds into the live turn's steps and the last text stays the answer", () => {
    const blocks = [steps("a"), answer("b", "Reading the config"), steps("c"), answer("d", "Done.")]
    const grouped = TranscriptBlocks.groupTurns(blocks, { live: () => true, fold: true, narration: true })
    expect(kinds(grouped)).toEqual(["steps(tool,text,tool)", "answer"])
  })

  test("a short streaming text stays in the narration line, and becomes the answer once it grows past one line", () => {
    const short = [steps("a"), answer("b", "I'll read the config", true)]
    expect(kinds(TranscriptBlocks.groupTurns(short, { live: () => true, fold: true, narration: true }))).toEqual([
      "steps(tool,text)",
    ])
    const long = [steps("a"), answer("b", "The build fails because the config is missing.\n\nThe fix", true)]
    expect(kinds(TranscriptBlocks.groupTurns(long, { live: () => true, fold: true, narration: true }))).toEqual([
      "steps(tool)",
      "answer",
    ])
  })

  test("the streaming text stays a full answer until a tool call follows it", () => {
    const blocks = [steps("a"), answer("b", "Reading the config file in full. ".repeat(6), true)]
    expect(kinds(TranscriptBlocks.groupTurns(blocks, { live: () => true, fold: true, narration: true }))).toEqual([
      "steps(tool)",
      "answer",
    ])
  })

  test("without narration, a live turn keeps every text as an answer", () => {
    const blocks = [steps("a"), answer("b", "Reading the config"), steps("c"), answer("d", "Done.")]
    expect(kinds(TranscriptBlocks.groupTurns(blocks, { live: () => true, fold: true }))).toEqual([
      "steps(tool,tool)",
      "answer",
      "answer",
    ])
  })
})
