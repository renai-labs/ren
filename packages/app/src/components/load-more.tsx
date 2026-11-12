import { Spinner } from "@ren/ui/spinner"

export function LoadMore(props: { more: boolean; loading?: boolean | undefined; onMore: () => void }) {
  if (props.loading)
    return (
      <div className="flex justify-center py-2 text-muted-foreground">
        <Spinner />
      </div>
    )
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
