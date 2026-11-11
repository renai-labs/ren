import { fromDom } from "hast-util-from-dom"
import { toMdast } from "hast-util-to-mdast"
import { gfmToMarkdown } from "mdast-util-gfm"
import { toMarkdown } from "mdast-util-to-markdown"

// Chromium's default copy inlines computed styles, so text copied from a dark theme pastes as light text on the
// destination's white page. Copied HTML keeps only semantic markup, and copied text is the Markdown of that HTML.

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

// Ancestors that give a partial selection its meaning, such as a phrase inside bold text or an item inside a list.
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
  "LI",
  "OL",
  "P",
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

const keptAttributes = new Set(["alt", "colspan", "rowspan", "start"])

const linkProtocols = new Set(["http:", "https:", "mailto:"])

const webProtocols = new Set(["http:", "https:"])

const hasProtocol = (value: string, protocols: Set<string>) =>
  URL.canParse(value) && protocols.has(new URL(value).protocol)

const sanitizeAttributes = (element: Element) => {
  for (const attribute of Array.from(element.attributes)) {
    if (keptAttributes.has(attribute.name)) continue
    if (attribute.name === "href" && element.tagName === "A" && hasProtocol(attribute.value, linkProtocols)) continue
    if (attribute.name === "src" && element.tagName === "IMG" && hasProtocol(attribute.value, webProtocols)) continue
    element.removeAttribute(attribute.name)
  }
}

// Highlighted lines are block spans with no newline between them, so a block's text is its lines joined.
const codeText = (scope: ParentNode) => {
  const lines = scope.querySelectorAll('[data-slot="code-block-line"]')
  const text =
    lines.length === 0
      ? (scope.textContent ?? "")
      : Array.from(lines, (line) => (line.textContent ?? "").replace(/\n$/u, "")).join("\n")
  return text.replace(/\n$/u, "")
}

export interface MarkdownClipboard {
  readonly text: string
  readonly html: string
}

// Returns undefined when the browser's own copy should run: a collapsed selection, or one that leaves `root`.
export function markdownClipboard(root: Element, range: Range): MarkdownClipboard | undefined {
  const ancestor = range.commonAncestorContainer
  if (range.collapsed || !root.contains(ancestor)) return undefined
  const start = ancestor instanceof Element ? ancestor : ancestor.parentElement

  const code = start?.closest("pre, code")
  if (code && root.contains(code)) {
    const text = code.tagName === "PRE" ? codeText(range.cloneContents()) : range.toString()
    if (text === "") return undefined
    const element = document.createElement("code")
    element.textContent = text
    const container = document.createElement("div")
    if (code.tagName === "PRE") {
      const pre = document.createElement("pre")
      pre.appendChild(element)
      container.appendChild(pre)
    } else container.appendChild(element)
    return { text, html: container.innerHTML }
  }

  let content: Node = range.cloneContents()
  for (
    let element = start;
    element && element !== root && root.contains(element);
    element = element.parentElement
  ) {
    if (!semanticTags.has(element.tagName)) continue
    const wrapper = element.cloneNode(false)
    wrapper.appendChild(content)
    content = wrapper
  }

  const container = document.createElement("div")
  container.appendChild(content)
  container.querySelectorAll<HTMLElement>("[data-app-mention]").forEach((mention) => {
    mention.replaceWith(`@${mention.dataset.appMention ?? ""}`)
  })
  container.querySelectorAll<HTMLElement>('[data-slot="code-block"]').forEach((block) => {
    const pre = document.createElement("pre")
    const element = document.createElement("code")
    if (block.dataset.language) element.className = `language-${block.dataset.language}`
    element.textContent = codeText(block)
    pre.appendChild(element)
    block.replaceWith(pre)
  })

  const markdown = container.cloneNode(true)
  if (!(markdown instanceof HTMLElement)) return undefined
  markdown.querySelectorAll(markdownRemovedSelector).forEach((element) => element.remove())
  markdown.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
    box.toggleAttribute("checked", box.checked)
  })

  container.querySelectorAll(htmlRemovedSelector).forEach((element) => element.remove())
  container.querySelectorAll("*").forEach(sanitizeAttributes)

  return {
    text: toMarkdown(toMdast(fromDom(markdown)), { extensions: [gfmToMarkdown()] }).trim(),
    html: container.innerHTML,
  }
}
