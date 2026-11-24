import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@opencode/schema/session-message"
import { Schema } from "effect"
import { OpenCodeUnshownFiles } from "../src/harness/opencode/unshown-files.js"

const decode = Schema.decodeUnknownSync(SessionMessage.Info)

const folder = "/workspace/chat"

const user = (id: string, created: number) => decode({ id, type: "user", text: "Make the deck", time: { created } })

const tool = (name: string, path: string) => ({
  type: "tool",
  id: `call-${name}-${path}`,
  name,
  state: { status: "completed", input: { path }, content: [{ type: "text", text: "ok" }] },
  time: { created: 1_500, completed: 1_600 },
})

const assistant = (id: string, content: ReadonlyArray<object>) =>
  decode({
    id,
    type: "assistant",
    agent: "ren",
    model: { id: "model", providerID: "ren" },
    content,
    time: { created: 2_000 },
  })

const answer = (id: string, text: string) => assistant(id, [{ type: "text", text }])

describe("OpenCodeUnshownFiles.of", () => {
  test("a deliverable the answer names and the agent did not show is unshown, from the turn's start", () => {
    const found = OpenCodeUnshownFiles.of(
      [user("msg_1", 1_000), answer("msg_2", "Files are in outputs: bloon_visuals.html and `deck.pptx`.")],
      folder,
    )
    expect(found).toEqual({
      since: 1_000,
      paths: [`${folder}/bloon_visuals.html`, `${folder}/deck.pptx`],
    })
  })

  test("an HTML page the agent wrote is unshown even when the answer does not name it", () => {
    const found = OpenCodeUnshownFiles.of(
      [user("msg_1", 1_000), assistant("msg_2", [tool("write", "site/index.html")]), answer("msg_3", "Done.")],
      folder,
    )
    expect(found?.paths).toEqual([`${folder}/site/index.html`])
  })

  test("an HTML page the agent edited is unshown too", () => {
    const found = OpenCodeUnshownFiles.of(
      [user("msg_1", 1_000), assistant("msg_2", [tool("edit", "q1-goals.html")]), answer("msg_3", "Updated.")],
      folder,
    )
    expect(found?.paths).toEqual([`${folder}/q1-goals.html`])
  })

  test("a file the agent showed in this turn, code and names that are not files are left out", () => {
    const found = OpenCodeUnshownFiles.of(
      [
        user("msg_1", 1_000),
        assistant("msg_2", [tool("write", "reports/q3.html"), tool("show_file", "reports/q3.html")]),
        answer("msg_3", "See q3.html, the script build.py, e.g. Node.js and app.tsx:42."),
      ],
      folder,
    )
    expect(found?.paths).toEqual([])
  })

  test("only the latest turn counts, and Ren asks once per turn", () => {
    const earlier = [user("msg_1", 1_000), answer("msg_2", "Here is old.pdf.")]
    expect(
      OpenCodeUnshownFiles.of([...earlier, user("msg_3", 5_000), answer("msg_4", "Done.")], folder)?.paths,
    ).toEqual([])
    const asked = decode({
      id: "msg_5",
      type: "synthetic",
      text: "Show them",
      metadata: { [OpenCodeUnshownFiles.marker]: true },
      time: { created: 6_000 },
    })
    expect(
      OpenCodeUnshownFiles.of([user("msg_3", 5_000), answer("msg_4", "See new.pdf."), asked], folder),
    ).toBeUndefined()
  })
})
