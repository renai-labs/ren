import { describe, expect, test } from "bun:test"
import { ChatLink } from "../src/chat-link.js"

const app = "https://ren.example.com/app"
const parent = "ses_01M770TSCJ2WJ8PFY0FGS5S91J"
const child = "ses_01M76710XXAVG1C16HQNJSGBQC"

describe("ChatLink.parse", () => {
  test("reads a chat URL", () => {
    expect(ChatLink.parse(`${app}/sessions/${parent}`, app)).toEqual({ id: parent })
    expect(ChatLink.parse(`${app}/sessions/${parent}/`, `${app}/`)).toEqual({ id: parent })
  })

  test("reads the subagent of a chat URL", () => {
    expect(ChatLink.parse(`${app}/sessions/${parent}?child=${child}`, app)).toEqual({ id: parent, child })
    expect(ChatLink.parse(`${app}/sessions/${parent}?child=nope`, app)).toEqual({ id: parent })
  })

  test("does not match another origin, another path or another ID shape", () => {
    expect(ChatLink.parse(`https://other.example.com/app/sessions/${parent}`, app)).toBeUndefined()
    expect(ChatLink.parse(`${app}/tasks/RENAI-1`, app)).toBeUndefined()
    expect(ChatLink.parse(`${app}/sessions/ses_short`, app)).toBeUndefined()
    expect(ChatLink.parse(`https://ren.example.com/sessions/${parent}`, app)).toBeUndefined()
  })

  test("reads the link the markdown step writes for a bare ID", () => {
    expect(ChatLink.parse(`${ChatLink.hash}${parent}`, app)).toEqual({ id: parent })
  })
})

describe("ChatLink.ids", () => {
  test("finds a bare ID with its position", () => {
    const text = `see ${parent}, then ${child}.`
    expect(ChatLink.ids(text)).toEqual([
      { id: parent, start: 4, end: 4 + parent.length },
      { id: child, start: text.indexOf(child), end: text.indexOf(child) + child.length },
    ])
  })

  test("skips an ID of another length or glued to a word", () => {
    expect(ChatLink.ids(`${parent}0`)).toEqual([])
    expect(ChatLink.ids(parent.slice(0, -1))).toEqual([])
    expect(ChatLink.ids(`x${parent}`)).toEqual([])
    expect(ChatLink.ids("ses_01JD…")).toEqual([])
  })
})

describe("ChatLink.link", () => {
  const text = (value: string): ChatLink.Node => ({ type: "text", value })
  const element = (tagName: string, ...children: ChatLink.Node[]): ChatLink.Node => ({
    type: "element",
    tagName,
    properties: {},
    children,
  })

  test("turns a bare ID in text into a link", () => {
    const tree = element("p", text(`see ${parent} now`))
    ChatLink.link(tree)
    expect(tree.children).toEqual([
      text("see "),
      { type: "element", tagName: "a", properties: { href: `#ren-chat:${parent}` }, children: [text(parent)] },
      text(" now"),
    ])
  })

  test("turns inline code that holds only an ID into a link", () => {
    const tree = element("p", element("code", text(parent)))
    ChatLink.link(tree)
    expect(tree.children?.[0]).toMatchObject({ tagName: "a", properties: { href: `#ren-chat:${parent}` } })
  })

  test("leaves a code block, a link and other inline code alone", () => {
    const block = element("pre", element("code", text(parent)))
    const linked = element("a", text(parent))
    const mixed = element("code", text(`resume ${parent}`))
    const tree = element("div", block, linked, mixed)
    ChatLink.link(tree)
    expect(tree.children).toEqual([
      element("pre", element("code", text(parent))),
      element("a", text(parent)),
      element("code", text(`resume ${parent}`)),
    ])
  })
})
