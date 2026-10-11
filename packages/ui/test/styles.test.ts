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
  test("use no raw colour literals outside the generated tokens", () => {
    const literal = /(lch\(|oklch\(|hsla?\(|color-mix\(|#[0-9a-fA-F]{6}\b|rgba?\([0-9])/
    const offending = sources
      .filter((source) => !source.file.endsWith("tokens.generated.css"))
      .filter((source) => literal.test(source.text))
      .map((source) => source.file)
    expect(offending).toEqual([])
  })

  test("CSS and HTML carry no comments", () => {
    const comment = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|^\s*\/\/(?!.*https?:)/m
    const offending = sources
      .filter((source) => source.file.endsWith(".css") || source.file.endsWith(".html"))
      .filter((source) => comment.test(source.text.replaceAll(/"[^"\n]*"/g, '""')))
      .map((source) => source.file)
    expect(offending).toEqual([])
  })
})
