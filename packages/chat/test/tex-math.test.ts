import { describe, expect, test } from "bun:test"
import { TexMath } from "../src/tex-math.js"

describe("TexMath.rewrite", () => {
  test("rewrites inline parentheses to $$", () => {
    expect(TexMath.rewrite("so \\(x^2 + 1\\) holds")).toBe("so $$x^2 + 1$$ holds")
  })

  test("rewrites brackets to a $$ block", () => {
    expect(TexMath.rewrite("before\n\\[\nE = mc^2\n\\]\nafter")).toBe("before\n\n$$\nE = mc^2\n$$\n\nafter")
    expect(TexMath.rewrite("\\[a+b\\]")).toBe("\n$$\na+b\n$$\n")
  })

  test("leaves inline code alone", () => {
    expect(TexMath.rewrite("use `\\(x\\)` or ``\\[y\\]`` here")).toBe("use `\\(x\\)` or ``\\[y\\]`` here")
  })

  test("leaves escaped and unclosed delimiters alone", () => {
    expect(TexMath.rewrite("a \\\\(b\\\\) c")).toBe("a \\\\(b\\\\) c")
    expect(TexMath.rewrite("still \\(x^2")).toBe("still \\(x^2")
  })

  test("leaves dollar prices alone", () => {
    expect(TexMath.rewrite("costs $5 and $10")).toBe("costs $5 and $10")
  })
})
