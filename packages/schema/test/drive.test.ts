import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Drive } from "../src/drive.js"

const accepts = (path: string) => Exit.isSuccess(Schema.decodeUnknownExit(Drive.Path)(path))

describe("Drive.Path", () => {
  test.each(["q3.pdf", "reports/2026/q3.pdf", "notes v2.md", "résumé.pdf", ".env.example", "a..b"])(
    "accepts %s",
    (path) => {
      expect(accepts(path)).toBe(true)
    },
  )

  test.each(["", "/q3.pdf", "reports/", "reports//q3.pdf", "../q3.pdf", "reports/../q3.pdf", "./q3.pdf", "a\nb"])(
    "rejects %j",
    (path) => {
      expect(accepts(path)).toBe(false)
    },
  )

  test("normalizes a path to NFC, so a name that macOS sends decomposed finds its file", () => {
    expect(Schema.decodeUnknownSync(Drive.Path)("cv/re\u0301sume\u0301.pdf")).toBe("cv/r\u00E9sum\u00E9.pdf")
  })

  test("limits a name to 255 bytes, as a Linux folder does", () => {
    expect(accepts("é".repeat(127))).toBe(true)
    expect(accepts("é".repeat(128))).toBe(false)
  })

  test("limits a path so that its S3 key stays within 1024 bytes", () => {
    const name = "a".repeat(255)
    expect(accepts([name, name, name].join("/"))).toBe(true)
    expect(accepts([name, name, name, name].join("/"))).toBe(false)
  })
})
