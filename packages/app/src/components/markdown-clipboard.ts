import { fromDom } from "hast-util-from-dom"
import { toMdast } from "hast-util-to-mdast"
import { gfmToMarkdown } from "mdast-util-gfm"
import { toMarkdown } from "mdast-util-to-markdown"

const removedSelectors = [
  "button",
  "textarea",
  "select",
  "script",
  "style",
  "template",
  "svg",
  "[hidden]",
  '[aria-hidden="true"]',
  ".sr-only",
  '[data-slot="code-block-header"]',
]

const htmlRemovedSelector = ["input", ...removedSelectors].join(", ")
const markdownRemovedSelector = ['input:not([type="checkbox"])', ...removedSelectors].join(", ")

const semanticTags = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "DEL",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "I",
  "KBD",
  "OL",
  "S",
  "STRONG",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "UL",
])

const boldSelector = '[data-streamdown="strong"]'

const keptAttributes = new Set(["alt", "colspan", "rowspan", "start"])

const linkProtocols = new Set(["http:", "https:", "mailto:"])

const webProtocols = new Set(["http:", "https:"])

const hasProtocol = (value: string, protocols: Set<string>) =>
  URL.canParse(value) && protocols.has(new URL(value).protocol)

const sanitizeAttributes = (element: Element) => {
  for (const name of element.getAttributeNames()) {
    const value = element.getAttribute(name) ?? ""
    if (keptAttributes.has(name)) continue
    if (name === "href" && element.tagName === "A" && hasProtocol(value, linkProtocols)) continue
    if (name === "src" && element.tagName === "IMG" && hasProtocol(value, webProtocols)) continue
    element.removeAttribute(name)
  }
}

const codeText = (scope: ParentNode) => {
  const lines = scope.querySelectorAll('[data-slot="code-block-line"]')
  const text =
    lines.length === 0
      ? (scope.textContent ?? "")
      : [...lines].map((line) => line.textContent.replace(/\n$/u, "")).join("\n")
  return text.replace(/\n$/u, "")
}

export interface MarkdownClipboard {
  readonly text: string
  readonly html: string
}

const codeOnlyClipboard = (code: Element, range: Range) => {
  const isBlock = code.tagName === "PRE"
  const text = isBlock ? codeText(range.cloneContents()) : range.toString()
  if (text === "") return null
  const element = document.createElement("code")
  element.textContent = text
  const container = document.createElement("div")
  if (isBlock) {
    const pre = document.createElement("pre")
    pre.appendChild(element)
    container.appendChild(pre)
  } else container.appendChild(element)
  return { text, html: container.innerHTML }
}

const normalize = (container: Element) => {
  for (const bold of container.querySelectorAll(boldSelector)) {
    const strong = document.createElement("strong")
    strong.append(...bold.childNodes)
    bold.replaceWith(strong)
  }
  for (const mention of container.querySelectorAll<HTMLElement>("[data-app-mention]")) {
    mention.replaceWith(`@${mention.dataset.appMention ?? ""}`)
  }
  for (const block of container.querySelectorAll<HTMLElement>('[data-slot="code-block"]')) {
    const pre = document.createElement("pre")
    const element = document.createElement("code")
    if (block.dataset.language) element.className = `language-${block.dataset.language}`
    element.textContent = codeText(block)
    pre.appendChild(element)
    block.replaceWith(pre)
  }
}

const rewrap = (range: Range, root: Element) => {
  const ancestor = range.commonAncestorContainer
  let content: Node = range.cloneContents()
  for (
    let element = ancestor instanceof Element ? ancestor : ancestor.parentElement;
    element && element !== root && root.contains(element);
    element = element.parentElement
  ) {
    const bold = element.matches(boldSelector)
    if (!bold && !semanticTags.has(element.tagName)) continue
    const wrapper = bold ? document.createElement("strong") : element.cloneNode(false)
    wrapper.appendChild(content)
    content = wrapper
  }
  return content
}

const markdownOf = (container: Element) => {
  const copy = document.createElement("div")
  copy.append(...[...container.childNodes].map((node) => node.cloneNode(true)))
  for (const element of copy.querySelectorAll(markdownRemovedSelector)) element.remove()
  for (const box of copy.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    box.toggleAttribute("checked", box.checked)
  }
  return toMarkdown(toMdast(fromDom(copy)), { bullet: "-", extensions: [gfmToMarkdown()] }).trim()
}

export function markdownClipboard(root: Element, range: Range): MarkdownClipboard | null {
  const ancestor = range.commonAncestorContainer
  if (range.collapsed || !root.contains(ancestor)) return null
  const start = ancestor instanceof Element ? ancestor : ancestor.parentElement

  const code = start?.closest("pre") ?? start?.closest("code")
  if (code && root.contains(code)) return codeOnlyClipboard(code, range)

  const container = document.createElement("div")
  container.appendChild(rewrap(range, root))
  normalize(container)
  const text = markdownOf(container)

  for (const element of container.querySelectorAll(htmlRemovedSelector)) element.remove()
  for (const element of container.querySelectorAll("*")) sanitizeAttributes(element)
  return { text, html: container.innerHTML }
}
