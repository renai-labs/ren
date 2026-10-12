import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Avatar } from "../src/components/avatar.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Avatar.Root", () => {
  test("labels itself with the name and shows initials", () => {
    const avatar = html(renderToStaticMarkup(<Avatar.Root name="Ada Lovelace" />)).querySelector('[data-slot="avatar"]')
    expect(avatar?.getAttribute("role")).toBe("img")
    expect(avatar?.getAttribute("aria-label")).toBe("Ada Lovelace")
    expect(avatar?.textContent).toBe("AL")
  })

  test("keeps at most two initials and falls back to a question mark", () => {
    expect(html(renderToStaticMarkup(<Avatar.Root name="Grace Brewster Murray Hopper" />)).textContent).toBe("GB")
    expect(html(renderToStaticMarkup(<Avatar.Root name="" />)).textContent).toBe("?")
  })

  test("drops its label when decorative", () => {
    const avatar = html(renderToStaticMarkup(<Avatar.Root name="Ada Lovelace" decorative />)).querySelector(
      '[data-slot="avatar"]',
    )
    expect(avatar?.hasAttribute("role")).toBe(false)
    expect(avatar?.hasAttribute("aria-label")).toBe(false)
  })

  test("draws a hidden glyph instead of initials", () => {
    const avatar = html(renderToStaticMarkup(<Avatar.Root name="Files" glyph="Folder" />)).querySelector(
      '[data-slot="avatar"]',
    )
    expect(avatar?.getAttribute("aria-label")).toBe("Files")
    expect(avatar?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
    expect(avatar?.textContent).toBe("")
  })

  test("draws an emoji", () => {
    expect(html(renderToStaticMarkup(<Avatar.Root name="Launch" emoji="🚀" />)).textContent).toBe("🚀")
  })
})

describe("Avatar.Group", () => {
  const people = [
    { key: "ada", name: "Ada Lovelace" },
    { key: "grace", name: "Grace Hopper" },
    { key: "alan", name: "Alan Turing" },
    { key: "edsger", name: "Edsger Dijkstra" },
  ]

  test("names every member and hides the individual avatars", () => {
    const group = html(renderToStaticMarkup(<Avatar.Group items={people.slice(0, 2)} />)).querySelector(
      '[data-slot="avatar-group"]',
    )
    expect(group?.getAttribute("role")).toBe("img")
    expect(group?.getAttribute("aria-label")).toBe("Ada Lovelace, Grace Hopper")
    expect(group?.querySelectorAll('[data-slot="avatar"][aria-label]').length).toBe(0)
  })

  test("collapses members past the limit into a count", () => {
    const group = html(renderToStaticMarkup(<Avatar.Group items={people} limit={3} />))
    expect(group.querySelectorAll('[data-slot="avatar"]').length).toBe(2)
    expect(group.querySelector("[title]")?.getAttribute("title")).toBe("Alan Turing, Edsger Dijkstra")
    expect(group.querySelector("[title]")?.textContent).toBe("+2")
  })

  test("renders nothing without members", () => {
    expect(renderToStaticMarkup(<Avatar.Group items={[]} />)).toBe("")
  })
})
