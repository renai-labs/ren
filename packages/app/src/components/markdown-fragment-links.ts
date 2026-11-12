function fragmentTarget(root: HTMLElement, id: string, fragment: string) {
  const lower = fragment.toLowerCase()
  const found = [fragment, `${id}-${lower}`, `user-content-${fragment}`].map((candidate) =>
    root.querySelector<HTMLElement>(`[id="${CSS.escape(candidate)}"]`),
  )
  return found.find((element) => element !== null) ?? undefined
}

function scrollParent(element: HTMLElement) {
  let parent = element.parentElement
  while (parent) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent
    parent = parent.parentElement
  }
  return null
}

function decodeFragment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function scrollToFragment(
  root: HTMLElement,
  id: string,
  href: string,
  release?: (viewport: HTMLElement) => void,
) {
  const fragment = decodeFragment(href.slice(1))
  const target = fragment ? fragmentTarget(root, id, fragment) : undefined
  if (!target) return
  const scroller = scrollParent(root)
  if (!scroller) return
  release?.(scroller)
  // ast-grep-ignore: no-manual-scroll -- a link jumps to its target in the transcript, which MessageScroller has no API for
  scroller.scrollTo({
    top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
  })
}
