import { describe, expect, test } from "bun:test"
import { FormProgress } from "./form-progress.js"

const progress = (step: number) => ({ step, answers: {} })

describe("form progress", () => {
  test("keeps the latest progress per form until it is cleared", () => {
    FormProgress.write("frm_a", progress(1))
    FormProgress.write("frm_a", progress(2))
    expect(FormProgress.read("frm_a")).toEqual(progress(2))
    FormProgress.clear("frm_a")
    expect(FormProgress.read("frm_a")).toBeUndefined()
  })

  test("forgets the oldest form past its limit", () => {
    Array.from({ length: 51 }, (_, index) => FormProgress.write(`frm_${index}`, progress(index)))
    expect(FormProgress.read("frm_0")).toBeUndefined()
    expect(FormProgress.read("frm_50")).toEqual(progress(50))
  })
})
