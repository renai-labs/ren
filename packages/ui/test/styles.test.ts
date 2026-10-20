import { describe, expect, test } from "bun:test"
import { Glob } from "bun"
import path from "path"

const packages = path.resolve(import.meta.dir, "../..")
const sources = await Promise.all(
  [...(await Array.fromAsync(new Glob("{ui,app}/src/**/*.{ts,tsx,css}").scan({ cwd: packages }))), "app/index.html"]
    .filter((file) => !file.endsWith(".gen.ts"))
    .map(async (file) => ({ file, text: await Bun.file(path.join(packages, file)).text() })),
)

describe("frontend sources", () => {
  test("use no raw colour literals outside the generated tokens and brand marks", () => {
    const literal = /(lch\(|oklch\(|hsla?\(|color-mix\(|#[0-9a-fA-F]{6}\b|rgba?\([0-9])/
    const offending = sources
      .filter((source) => !source.file.endsWith("tokens.generated.css") && !source.file.endsWith("brand-mark.tsx"))
      .filter((source) => literal.test(source.text))
      .map((source) => source.file)
    expect(offending).toEqual([])
  })

  test("stylesheets avoid declarations that break motion, type or touch", () => {
    const banned = [
      /transition(?:-property)?:\s*all\b/,
      /will-change:\s*all\b/,
      /line-height:\s*[\d.]+(?:px|rem)\b/,
      /letter-spacing:\s*-?[\d.]+px\b/,
      /font-synthesis:\s*none\b/,
      /font-variation-settings:[^;]*"(?:wght|opsz)"/,
      /font-feature-settings:[^;]*"(?:tnum|zero)"/,
      /text-decoration-skip-ink:\s*none\b/,
      /text-align:\s*justify\b/,
    ]
    const offending = sources
      .filter((source) => source.file.endsWith(".css"))
      .flatMap((source) =>
        banned.filter((pattern) => pattern.test(source.text)).map((pattern) => `${source.file}: ${pattern.source}`),
      )
    expect(offending).toEqual([])
  })

  test("hover styles apply only on hover-capable pointers", () => {
    const withoutHoverMedia = (text: string): string => {
      const start = text.indexOf("@media (hover: hover)")
      if (start === -1) return text
      const open = text.indexOf("{", start)
      const close = Array.from(text.slice(open), (character) => character).reduce(
        (state, character, index) => {
          if (state.end !== -1) return state
          const depth = state.depth + (character === "{" ? 1 : 0) - (character === "}" ? 1 : 0)
          return { depth, end: depth === 0 ? open + index : -1 }
        },
        { depth: 0, end: -1 },
      ).end
      return withoutHoverMedia(text.slice(0, start) + text.slice(close + 1))
    }
    const offending = sources
      .filter((source) => source.file.endsWith(".css"))
      .filter((source) => withoutHoverMedia(source.text).includes(":hover"))
      .map((source) => source.file)
    expect(offending).toEqual([])
  })

  test("font smoothing is set once, on the root", () => {
    const offending = sources.filter((source) => source.text.includes("font-smoothing")).map((source) => source.file)
    expect(offending).toEqual(["ui/src/styles/theme.css"])
  })
})
