import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect } from "effect"
import { join } from "node:path"
import { TestDrive } from "./lib/drive.js"

const it = testEffect(TestDrive.layer)

const workspace = TestDrive.workspace

const driveOf = TestDrive.driveOf

const pdf = TestDrive.pdf

it.live("a file that is not in the drive refuses the message, with its name", () =>
  Effect.gen(function* () {
    const drive = yield* driveOf({ "notes.md": "hi" })
    const refused = yield* Effect.flip(
      drive.attach([
        { path: "notes.md", name: "notes.md" },
        { path: "chats/ses_1/uploads/msg_1/gone.pdf", name: "gone.pdf" },
      ]),
    )
    expect(refused).toMatchObject({ _tag: "DriveFiles.Refused" })
    expect(refused.message).toContain("gone.pdf")
  }),
)

it.live(
  "show copies a file into the chat's outputs in the drive and gives its drive path; a file already there stays, a missing one is refused",
  () =>
    Effect.gen(function* () {
      const drive = yield* driveOf({})
      const made = join(workspace, drive.sessionId, "report.pdf")
      yield* Effect.promise(() => Bun.write(made, pdf(10)))
      const shown = yield* drive.show(made)
      const path = `chats/${drive.sessionId}/outputs/report.pdf`
      expect(shown).toEqual({ path, name: "report.pdf", mime: "application/pdf", size: 19 })
      expect(yield* Effect.promise(() => Bun.file(join(drive.root, path)).bytes())).toEqual(pdf(10))
      expect(yield* drive.show(join(drive.root, path))).toEqual(shown)
      const missing = yield* Effect.flip(drive.show(join(workspace, drive.sessionId, "gone.png")))
      expect(missing).toMatchObject({ _tag: "DriveFiles.Refused" })
      expect(missing.message).toContain("gone.png")
    }),
)
