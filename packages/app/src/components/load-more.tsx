export function LoadMore(props: { onVisible: () => void }) {
  return (
    <div
      aria-hidden
      className="h-px shrink-0"
      ref={(node) => {
        if (!node) return
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) props.onVisible()
          },
          { rootMargin: "240px 0px" },
        )
        observer.observe(node)
        return () => observer.disconnect()
      }}
    />
  )
}
