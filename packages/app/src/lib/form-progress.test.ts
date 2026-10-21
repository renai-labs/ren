import { expect, test } from "bun:test"
import { FormProgress } from "./form-progress.js"

const progress = (step: number) => ({ step, answers: {} })

test("forgets the least recently saved form past its limit", () => {
  Array.from({ length: 50 }, (_, index) => FormProgress.write(`frm_${index}`, progress(index)))
  FormProgress.write("frm_0", progress(1))
  FormProgress.write("frm_50", progress(50))
  expect(FormProgress.read("frm_0")).toEqual(progress(1))
  expect(FormProgress.read("frm_1")).toBeUndefined()
})
