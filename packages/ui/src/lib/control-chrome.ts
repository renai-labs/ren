export const controlOutline = "rounded-control bg-background-secondary inset-ring-1 inset-ring-border-primary"

export const controlSize = {
  small: "h-7 px-2 text-xs",
  compact: "h-7 px-3 text-sm",
  medium: "h-8 px-3 text-sm",
  large: "h-10 px-3 text-sm",
} as const

export const popupSurface =
  "origin-(--transform-origin) rounded-control bg-background-secondary text-text-primary shadow-overlay transition-standard outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"

const optionRowBase =
  "relative flex min-h-8 w-full cursor-default items-center gap-2 rounded-small px-2 py-1 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-disabled [&_svg]:size-4 [&_svg]:shrink-0"

export const optionRow = `${optionRowBase} text-text-primary data-highlighted:bg-fill-secondary`

export const revealOnContainerHover =
  "focus-visible:opacity-100 data-checked:opacity-100 data-popup-open:opacity-100 sm:opacity-0 sm:group-hover/surface:opacity-100 sm:group-hover/board-card:opacity-100 sm:group-hover/task-row:opacity-100"
