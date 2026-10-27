import { cn } from "@/lib/utils"

const sizes = {
  sm: "size-5 rounded-sm text-[10px]",
  md: "size-8 rounded-lg text-sm",
  lg: "size-10 rounded-lg text-base",
  xl: "size-11 rounded-xl text-lg",
}

export function AppIcon(props: {
  name: string
  icon?: string | null | undefined
  size?: keyof typeof sizes | undefined
  className?: string | undefined
}) {
  const size = sizes[props.size ?? "md"]
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden bg-secondary font-medium text-foreground",
        size,
        props.className,
      )}
    >
      {props.icon ? (
        <img src={props.icon} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        props.name[0]
      )}
    </span>
  )
}
