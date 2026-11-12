import { describe, expect, test } from "bun:test"
import { LinkPreview } from "../src/link-preview.js"

const id = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9"

describe("LinkPreview.classify", () => {
  test("names each previewable link by a short ref", () => {
    expect(LinkPreview.classify("https://github.com/RenAI/Ren/pull/337/files")).toEqual({
      kind: "github_pr",
      key: "renai/ren#337",
      ref: "RenAI/Ren#337",
    })
    expect(LinkPreview.classify("https://github.com/renai/ren/issues/9")).toMatchObject({
      kind: "github_issue",
      ref: "renai/ren#9",
    })
    expect(LinkPreview.classify("https://linear.app/renai/issue/renai-35/fix-it")).toMatchObject({
      kind: "linear_issue",
      ref: "RENAI-35",
    })
  })

  test("finds a Notion page id at the end of the path, with or without dashes", () => {
    const compact = id.replaceAll("-", "")
    for (const url of [
      `https://www.notion.so/acme/Launch-plan-${compact}?pvs=4`,
      `https://www.notion.so/${compact}`,
      `https://acme.notion.site/Launch-plan-${compact}`,
      `https://www.notion.so/acme/${id}`,
    ])
      expect(LinkPreview.classify(url)).toMatchObject({ kind: "notion_page", key: id })
  })

  test("leaves other links alone", () => {
    for (const url of [
      "https://example.com/acme/issue/A-1",
      "https://www.notion.so/acme/Launch-plan",
      "https://github.com/renai/ren",
      "not a url",
    ])
      expect(LinkPreview.classify(url)).toBeUndefined()
  })
})
