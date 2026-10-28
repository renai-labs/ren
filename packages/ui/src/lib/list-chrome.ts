import { cva } from "class-variance-authority"

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
