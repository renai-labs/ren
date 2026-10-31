import { useEffect, type RefObject } from "react"

export function usePinToEnd(
  ref: RefObject<HTMLElement | null>,
  options: { readonly pinned: boolean; readonly count: number },
) {
  const pinned = options.pinned
  const count = options.count
  useEffect(() => {
    const node = ref.current
    // ast-grep-ignore: no-manual-scroll -- the activity log is not a chat; its Live toggle pins it to the newest step
    if (pinned && node) node.scrollTop = node.scrollHeight
  }, [ref, pinned, count])
}
