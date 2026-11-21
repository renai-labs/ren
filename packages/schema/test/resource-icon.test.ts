import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { ResourceIcon } from "../src/resource-icon.js"

const accepts = (value: string) => Exit.isSuccess(Schema.decodeUnknownExit(ResourceIcon.Descriptor)(value))

describe("ResourceIcon.parse", () => {
  test("reads each of the three forms", () => {
    expect(ResourceIcon.parse("tabler:IconRocket:violet")).toEqual({
      type: "tabler",
      name: "IconRocket",
      color: "violet",
    })
    expect(ResourceIcon.parse(":🚀")).toEqual({ type: "emoji", emoji: "🚀" })
    expect(ResourceIcon.parse("https://ren.example/icons/a.webp")).toEqual({
      type: "image",
      url: "https://ren.example/icons/a.webp",
    })
  })

  test("reads a photo that the old picker saved as a data URL, so it still shows", () => {
    expect(ResourceIcon.parse("data:image/jpeg;base64,/9j/4AAQ")?.type).toBe("image")
    expect(ResourceIcon.parse("data:image/svg+xml;utf8,%3Csvg%3E")?.type).toBe("image")
  })

  test.each([
    "",
    "tabler:IconRocket:cyan",
    "tabler:rocket:violet",
    ":smile",
    "http://ren.example/a.webp",
    "javascript:alert(1)",
  ])("returns undefined for %j", (value) => {
    expect(ResourceIcon.parse(value)).toBeUndefined()
  })
})

describe("ResourceIcon.Descriptor", () => {
  test.each([
    "tabler:IconRocket:neutral",
    ":👩‍💻",
    "https://ren.example/icons/a.webp",
    "https://lh3.googleusercontent.com/a/photo",
    "http://localhost:4000/icons/a.webp",
  ])("accepts %j", (value) => {
    expect(accepts(value)).toBe(true)
  })

  test.each([
    "data:image/jpeg;base64,/9j/4AAQ",
    "http://ren.example/icons/a.webp",
    "tabler:IconRocket:cyan",
    `https://ren.example/${"a".repeat(2048)}`,
  ])("rejects %j", (value) => {
    expect(accepts(value)).toBe(false)
  })
})
