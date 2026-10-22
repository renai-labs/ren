import { cva } from "class-variance-authority"

export type ListFrame = "card" | "plain" | "divided" | "ruled" | "flush"

export type ListState = "ready" | "loading" | "empty" | "failed"

export type ListDensity = "compact" | "regular" | "spacious"

export const listChrome = cva("", {
  variants: {
    frame: {
      card: "rounded-container border border-border-primary bg-background-secondary p-1 in-data-[slot=dialog-content]:bg-fill-primary",
      plain: "",
      divided:
        "rounded-container border border-border-primary bg-background-secondary in-data-[slot=dialog-content]:bg-fill-primary",
      ruled: "",
      flush: "",
    },
  },
  defaultVariants: { frame: "plain" },
})

export const listLayout = cva("flex min-w-0 flex-col", {
  variants: {
    frame: {
      card: "",
      plain: "gap-1",
      divided: "divide-y divide-border-primary",
      ruled: "divide-y divide-border-primary",
      flush: "",
    },
    height: { content: "", limited: "max-h-64 overflow-y-auto overscroll-contain" },
  },
  defaultVariants: { frame: "plain", height: "content" },
})

export const itemVariants = cva(
  "group/item relative flex w-full min-w-0 items-center text-start text-sm transition-standard focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-primary",
  {
    variants: {
      density: {
        compact: "min-h-8 gap-2 px-2 py-1",
        regular: "min-h-10 gap-3 px-3 py-2",
        spacious: "min-h-14 gap-3 px-4 py-3",
      },
      interactive: { true: "cursor-pointer rounded-control hover:bg-fill-primary", false: "" },
      selected: { true: "bg-fill-secondary", false: "" },
      disabled: { true: "pointer-events-none opacity-disabled", false: "" },
    },
    defaultVariants: { density: "regular", interactive: false, selected: false, disabled: false },
  },
)

export const leadingSlot =
  "flex shrink-0 items-center text-text-secondary [&_svg:not([data-slot=icon],[data-slot=avatar]_svg)]:size-4"
