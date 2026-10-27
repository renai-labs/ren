import { cn } from "../../lib/utils.js"

const BASE =
  "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform,opacity,filter] duration-[160ms] ease-(--ease-out-quad) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

const VARIANT = {
  primary: "border border-white bg-white text-black hover:bg-white/90",
  outline: "border border-tint-4 bg-transparent text-secondary-foreground hover:bg-tint-2 hover:text-foreground",
}

const SIZE = {
  sm: "h-8 gap-1 rounded-md px-4 text-sm",
  lg: "h-9 gap-2 rounded-lg px-3 text-base",
}

export function buttonClass(style: { variant: keyof typeof VARIANT; size: keyof typeof SIZE; className?: string }) {
  return cn(BASE, VARIANT[style.variant], SIZE[style.size], style.className)
}
