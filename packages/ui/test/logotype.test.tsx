import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Logotype } from "../src/components/logotype.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Logotype", () => {
  test("names itself Ren", () => {
    const logotype = html(renderToStaticMarkup(<Logotype />)).querySelector("svg")
    expect(logotype?.getAttribute("data-slot")).toBe("logotype")
    expect(logotype?.getAttribute("role")).toBe("img")
    expect(logotype?.getAttribute("aria-label")).toBe("Ren")
  })

  test("hides itself when the label is empty", () => {
    const logotype = html(renderToStaticMarkup(<Logotype label="" />)).querySelector("svg")
    expect(logotype?.getAttribute("aria-hidden")).toBe("true")
    expect(logotype?.hasAttribute("role")).toBe(false)
    expect(logotype?.hasAttribute("aria-label")).toBe(false)
  })

  test("strokes the outline drawing", () => {
    const paths = [...html(renderToStaticMarkup(<Logotype drawing="outline" />)).querySelectorAll("path")]
    expect(paths.map((path) => [path.getAttribute("fill"), path.getAttribute("stroke")])).toEqual([
      ["none", "currentColor"],
      ["none", "currentColor"],
      ["none", "currentColor"],
    ])
  })

  test("draws a progress bar while loading", () => {
    const paths = (activity: "none" | "loading") =>
      html(renderToStaticMarkup(<Logotype activity={activity} />)).querySelectorAll("path").length
    expect(paths("none")).toBe(3)
    expect(paths("loading")).toBe(4)
  })
})
