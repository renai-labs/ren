import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"
import { FileMentions } from "../src/file-mentions.js"

const at = (millis: number) => DateTime.makeUnsafe(millis)

const driveFile = (name: string, session = "ses_1"): SessionMessage.DriveFile => ({
  path: `chats/${session}/outputs/${name}`,
  name,
  mime: "text/html",
  size: 10,
})

const shown = (id: string, source: string, file: SessionMessage.DriveFile): SessionMessage.Assistant => ({
  id: SessionMessage.ID.make(id),
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [
    {
      type: "tool",
      id: `${id}-tool`,
      name: SessionMessage.showFileTool,
      state: { status: "completed", input: { path: source }, metadata: { file }, content: [] },
      time: { created: at(1), completed: at(2) },
    },
  ],
  time: { created: at(1), completed: at(2) },
})

const uploaded = (id: string, files: ReadonlyArray<SessionMessage.DriveFile>): SessionMessage.User => ({
  id: SessionMessage.ID.make(id),
  type: "user",
  text: "here",
  uploads: files,
  time: { created: at(0) },
})

describe("find", () => {
  const visuals = driveFile("bloon_visuals.html")
  const files = FileMentions.known([shown("msg_a1", "reports/bloon_visuals.html", visuals)])

  test.each([
    "bloon_visuals.html",
    "outputs/bloon_visuals.html",
    "reports/bloon_visuals.html",
    "./reports/bloon_visuals.html",
    "/workspace/ren/reports/bloon_visuals.html",
    visuals.path,
  ])("a file the agent showed is found as %s", (text) => {
    expect(FileMentions.find(files, text)).toEqual(visuals)
  })

  test("a name the chat has no file for is not found", () => {
    expect(FileMentions.find(files, "other.html")).toBeUndefined()
  })

  test("a path to another folder is not found by its name alone", () => {
    expect(FileMentions.find(files, "site/bloon_visuals.html")).toBeUndefined()
  })

  test("files the person uploaded are found", () => {
    const brief = driveFile("brief.pdf")
    expect(FileMentions.find(FileMentions.known([uploaded("msg_u1", [brief])]), "brief.pdf")).toEqual(brief)
  })

  test("the latest file of a name wins", () => {
    const first = driveFile("deck.pptx", "ses_1")
    const second = driveFile("deck.pptx", "ses_2")
    const known = FileMentions.known([shown("msg_a1", "deck.pptx", first), shown("msg_a2", "deck.pptx", second)])
    expect(FileMentions.find(known, "deck.pptx")).toEqual(second)
  })
})

describe("listed", () => {
  test("files in a listed drive folder become known files, and folders are skipped", () => {
    const listed = FileMentions.listed([
      { path: "chats/ses_1/outputs/old/", type: "directory" },
      { path: "chats/ses_1/outputs/deck.pptx", type: "file", size: 2048, mime: "application/x-deck" },
    ])
    expect(FileMentions.find(listed, "deck.pptx")).toEqual({
      path: "chats/ses_1/outputs/deck.pptx",
      name: "deck.pptx",
      mime: "application/x-deck",
      size: 2048,
    })
    expect(listed).toHaveLength(1)
  })
})
