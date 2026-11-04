import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { TaskAssignment } from "../src/task-assignment.js"

const info: TaskAssignment.Info = {
  taskId: "tsk_01",
  identifier: "REN-12",
  title: "Fix login: the redirect loops",
  brief: "The redirect loops after sign-in.\n\nHandoff note: check the cookie domain",
}

describe("TaskAssignment", () => {
  test("parse reads back the text an assignment is sent as", () => {
    expect(TaskAssignment.parse(TaskAssignment.text(info, "Read the task."))).toEqual(Option.some(info))
  })

  test("parse reads an assignment with only a heading", () => {
    const bare = { taskId: info.taskId, identifier: info.identifier, title: info.title, brief: "" }
    expect(TaskAssignment.parse(TaskAssignment.text(bare, "Read the task."))).toEqual(Option.some(bare))
  })

  test("parse ignores a message that only mentions an assignment", () => {
    expect(TaskAssignment.parse(`See ${TaskAssignment.text(info, "note")}`)).toEqual(Option.none())
  })
})
