import { describe, expect, test } from "bun:test"
import { InlineCodeKind } from "../src/inline-code-kind.js"

describe("inlineCodeKind", () => {
  test.each([
    "app.tsx",
    "app.tsx:42",
    "app.tsx#L42-L55",
    "src/file.ts",
    "C:\\tmp\\out.html",
    "/etc/hosts",
    "app/(auth)/[id]/page.tsx",
    "console.log",
    "Dockerfile",
    "Makefile:12",
  ])("treats %s as a possible path", (text) => {
    expect(InlineCodeKind.inlineCodeKind(text)).toBe("path")
  })

  test.each([
    "value",
    "readme",
    "1.2.3",
    "127.0.0.1:8080",
    "foo(bar)",
    "a = b",
    "<App />",
    "src/**/*.ts",
    "{ a: 1 }",
    "...",
    "ftp://x/y",
    "\\\\host\\share\\x.ts",
    "//host/share/x.ts",
  ])("leaves %s as code", (text) => {
    expect(InlineCodeKind.inlineCodeKind(text)).toBeUndefined()
  })

  test("detects http urls", () => {
    expect(InlineCodeKind.inlineCodeKind("https://opencode.ai/docs")).toBe("url")
  })
})

describe("workspacePath", () => {
  test.each([
    ["src/app.tsx", "src/app.tsx"],
    ["./src/app.tsx", "src/app.tsx"],
    ["src/app.tsx:42", "src/app.tsx"],
    ["src/app.tsx#L42", "src/app.tsx"],
    ["/workspace/ren/src/app.tsx:7", "src/app.tsx"],
    ["README.md", "README.md"],
  ])("resolves %s to %s", (text, path) => {
    expect(InlineCodeKind.workspacePath(text)).toBe(path)
  })

  test.each(["/etc/hosts", "../secret.ts", "src/", "C:\\tmp\\out.html", "value"])("leaves %s unresolved", (text) => {
    expect(InlineCodeKind.workspacePath(text)).toBeUndefined()
  })

  test("keeps the line", () => {
    expect(InlineCodeKind.parsePathLineSuffix("src/app.tsx:42").selection).toEqual({ start: 42, end: 42 })
    expect(InlineCodeKind.parsePathLineSuffix("src/app.tsx#L4-L9").selection).toEqual({ start: 4, end: 9 })
  })
})
