export * as ScrollAnchor from "./scroll-anchor.js"

const frames = 20

const shadowLines = (container: Element) => [...(container.shadowRoot?.querySelectorAll("[data-line]") ?? [])]

const linesOf = (scroller: HTMLElement) => [...scroller.querySelectorAll("diffs-container")].map(shadowLines)

export function keep(scroller: HTMLElement | null, change: () => void) {
  if (!scroller) return change()
  const top = scroller.getBoundingClientRect().top
  const anchor = linesOf(scroller).flatMap((lines, container) =>
    lines
      .filter((line) => line.getBoundingClientRect().bottom > top)
      .slice(0, 1)
      .map((line) => ({
        container,
        type: line.getAttribute("data-line-type"),
        line: line.getAttribute("data-line"),
        offset: line.getBoundingClientRect().top - top,
      })),
  )[0]
  change()
  if (!anchor) return
  const restore = (frame: number) => {
    const found = linesOf(scroller)[anchor.container]?.find(
      (line) => line.getAttribute("data-line") === anchor.line && line.getAttribute("data-line-type") === anchor.type,
    )
    if (found)
      // ast-grep-ignore: no-manual-scroll -- keeps the same diff line in view when the diff style changes
      scroller.scrollTop += found.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset
    if (frame < frames) requestAnimationFrame(() => restore(frame + 1))
  }
  requestAnimationFrame(() => restore(1))
}
