import { expect, test } from "bun:test"
import { SessionMessage } from "@opencode/schema/session-message"
import { Translate } from "@ren/opencode-transcript/translate"
import { Session } from "@ren/schema/session"
import { TaskAssignment } from "@ren/schema/task-assignment"
import { Option, Schema } from "effect"

const user = (metadata: Record<string, unknown>, text = "Look at these") =>
  Schema.decodeUnknownSync(SessionMessage.Info)({
    id: Session.MessageID.create(),
    type: "user",
    text,
    files: [
      { data: "c2hpcCBvbiBmcmlkYXk=", mime: "text/plain", source: { type: "inline" }, name: "plan.txt" },
      { data: "aGk=", mime: "text/plain", source: { type: "inline" }, name: "pasted.txt" },
    ],
    metadata: { userID: "user_1", ...metadata },
    time: { created: 1 },
  })

const plan = { path: "chats/ses_1/uploads/msg_1/plan.txt", name: "plan.txt", mime: "text/plain", size: 14 }
const report = { path: "chats/ses_1/uploads/msg_1/report.zip", name: "report.zip", mime: "application/zip", size: 9 }

test("a message that attached drive files gives them as uploads, without their bytes; a message without them keeps its files", () => {
  const attached = Option.getOrThrow(Translate.message(user({ files: [plan, report] })))
  expect(attached.type === "user" && attached.uploads).toEqual([plan, report])
  expect(attached.type === "user" && attached.files?.map((file) => file.name)).toEqual(["pasted.txt"])
  const inline = Option.getOrThrow(Translate.message(user({})))
  expect(inline.type === "user" && inline.uploads).toBeUndefined()
  expect(inline.type === "user" && inline.files?.map((file) => file.name)).toEqual(["plan.txt", "pasted.txt"])
})

const task = { taskId: "tsk_1", identifier: "REN-12", title: "Fix the login loop", brief: "It loops after sign-in." }

test("a task assignment reaches the chat as the message's task, from its metadata or, for older messages, its text", () => {
  const sent = Option.getOrThrow(Translate.message(user({ task }, TaskAssignment.text(task, "Read the task."))))
  expect(sent.type === "user" && sent.task).toEqual(task)
  const older = Option.getOrThrow(Translate.message(user({}, TaskAssignment.text(task, "Read the task."))))
  expect(older.type === "user" && older.task).toEqual(task)
  const plain = Option.getOrThrow(Translate.message(user({})))
  expect(plain.type === "user" && plain.task).toBeUndefined()
})
