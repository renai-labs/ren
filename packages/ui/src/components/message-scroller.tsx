import * as React from "react"
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller"
import { cn } from "cn"

import { Button } from "#components/button"
import { IconArrowDown } from "@tabler/icons-react"

function MessageScrollerProvider(props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

function MessageScroller({ className, ...props }: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn("group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden", className)}
      {...props}
    />
  )
}

const endSlack = 8

function usePinnedEnd(viewport: React.RefObject<HTMLDivElement | null>, options: { readonly enabled: boolean }) {
  const pinning = React.useEffectEvent(() => options.enabled)
  React.useLayoutEffect(() => {
    const element = viewport.current
    const content = element?.querySelector("[data-slot=message-scroller-content]")
    if (!element || !content || typeof ResizeObserver === "undefined") return
    const gap = () => element.scrollHeight - element.scrollTop - element.clientHeight
    const state = { atEnd: true }
    const onScroll = () => {
      if (element.hasAttribute("data-autoscrolling")) return
      state.atEnd = gap() <= endSlack
    }
    const observer = new ResizeObserver(() => {
      const spacer = element.querySelector<HTMLElement>("[data-message-scroller-spacer]")
      if (pinning() && state.atEnd && (spacer?.offsetHeight ?? 0) === 0 && gap() > 0.5)
        element.scrollTop = element.scrollHeight
    })
    element.addEventListener("scroll", onScroll, { passive: true })
    observer.observe(content)
    observer.observe(element)
    return () => {
      observer.disconnect()
      element.removeEventListener("scroll", onScroll)
    }
  }, [viewport])
}

function MessageScrollerViewport({
  className,
  ref,
  pinEnd = true,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport> & { pinEnd?: boolean }) {
  const viewport = React.useRef<HTMLDivElement | null>(null)
  usePinnedEnd(viewport, { enabled: pinEnd })
  return (
    <MessageScrollerPrimitive.Viewport
      ref={(element: HTMLDivElement | null) => {
        viewport.current = element
        if (typeof ref === "function") ref(element)
        else if (ref) ref.current = element
      }}
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 scroll-fade-y scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent data-pending-scroll:invisible",
        className,
      )}
      {...props}
    />
  )
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col gap-6", className)}
      {...props}
    />
  )
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn("min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]", className)}
      {...props}
    />
  )
}

function MessageScrollerButton({
  direction = "end",
  className,
  children,
  render,
  variant = "outline",
  size = "icon",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      direction={direction}
      className={cn(
        "absolute inset-s-1/2 -translate-x-1/2 rounded-full border-border bg-popover text-muted-foreground shadow-overlay transition-[translate,scale,opacity,color,background-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-90 data-[active=false]:opacity-0 data-[active=false]:duration-150 data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:active:scale-95 data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-2 data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-2 motion-reduce:transition-[opacity,color,background-color] rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180",
        className,
      )}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    >
      {children ?? (
        <>
          <IconArrowDown />
          <span className="sr-only">{direction === "end" ? "Scroll to end" : "Scroll to start"}</span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
}
