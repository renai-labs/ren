export function LoadMore(props: { more: boolean; onMore: () => void }) {
  if (!props.more) return null
  return (
    <div
      aria-hidden
      className="h-px shrink-0"
      ref={(node) => {
        if (!node) return
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) props.onMore()
          },
          { rootMargin: "320px 0px" },
        )
        observer.observe(node)
        return () => observer.disconnect()
      }}
    />
  )
}
