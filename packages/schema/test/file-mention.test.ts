import { describe, expect, test } from "bun:test"
import { FileMention } from "../src/file-mention.js"

describe("split", () => {
  test("finds a file name in a sentence and keeps the text around it", () => {
    expect(FileMention.split("Files are in outputs: bloon_visuals.html")).toEqual([
      { text: "Files are in outputs: ", mention: false },
      { text: "bloon_visuals.html", mention: true },
    ])
  })

  test.each([
    ["See reports/q3.pdf.", "reports/q3.pdf"],
    ["Open app.tsx:42 now", "app.tsx:42"],
    ["(Bloon_Audience_Visuals.pptx)", "Bloon_Audience_Visuals.pptx"],
    ["the résumé.pdf, attached", "résumé.pdf"],
    ["./out/data.csv", "./out/data.csv"],
  ])("finds the file in %s", (text, file) => {
    expect(FileMention.names(text)).toEqual([file])
  })

  test.each(["e.g. this", "version 1.2.3", "i.e. that", "https://example.com/a.html", "costs $0.00 now"])(
    "finds no file in %s",
    (text) => {
      expect(FileMention.names(text)).toEqual([])
    },
  )
})
