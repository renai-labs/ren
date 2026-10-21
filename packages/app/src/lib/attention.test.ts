import { describe, expect, test } from "bun:test"
import { Attention } from "./attention.js"

describe("signal", () => {
  test("a turn that ends without a question finishes", () => {
    expect(Attention.signal({ running: true, asking: 0 }, { running: false, asking: 0 })).toBe("finished")
  })

  test("a new permission or question needs input, even while the turn runs", () => {
    expect(Attention.signal({ running: true, asking: 0 }, { running: true, asking: 1 })).toBe("input")
  })

  test("an answered question or a turn that starts says nothing", () => {
    expect(Attention.signal({ running: true, asking: 1 }, { running: true, asking: 0 })).toBeUndefined()
    expect(Attention.signal({ running: false, asking: 0 }, { running: true, asking: 0 })).toBeUndefined()
  })
})
