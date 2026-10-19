import { describe, expect, test } from "bun:test"
import { Form } from "@ren/schema/form"
import { Schema } from "effect"
import { Requests } from "./requests.js"

const form = Schema.decodeUnknownSync(Form.Info)({
  id: "frm_1",
  sessionID: "ses_1",
  title: "Plan",
  fields: [
    { key: "scope", type: "string", title: "Scope", options: [{ value: "all", label: "All" }] },
    {
      key: "areas",
      type: "multiselect",
      title: "Areas",
      options: [
        { value: "ui", label: "UI" },
        { value: "api", label: "API" },
      ],
    },
    { key: "notes", type: "string", title: "Notes" },
    { key: "count", type: "number", title: "Count" },
  ],
})

const data = (entries: ReadonlyArray<readonly [string, string]>) =>
  entries.reduce((formData, entry) => {
    formData.append(entry[0], entry[1])
    return formData
  }, new FormData())

describe("form answers", () => {
  test("answers a single choice with one value, a multiple choice with all values, and leaves out blank answers", () => {
    expect(
      Requests.readFormAnswer(
        form,
        data([
          ["scope", "all"],
          ["areas", "ui"],
          ["areas", "api"],
          ["notes", "  "],
        ]),
      ),
    ).toEqual({ scope: "all", areas: ["ui", "api"] })
  })

  test("asks only the fields a choice list can answer, and lets a field without options take typed text", () => {
    const questions = Requests.formQuestions(form)
    expect(questions.map((question) => question.name)).toEqual(["scope", "areas", "notes"])
    expect(questions.at(2)?.customAnswer).toEqual({ label: "Type your own answer", placeholder: "Something else" })
  })
})

test("a permission reply is read only from the three known choices", () => {
  expect(Requests.readPermissionReply(data([[Requests.permissionField, "always"]]))).toBe("always")
  expect(Requests.readPermissionReply(data([[Requests.permissionField, "everything"]]))).toBeUndefined()
})
