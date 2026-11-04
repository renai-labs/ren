import type { Icon as TablerIcon, IconProps } from "@tabler/icons-react-native"
import { cn } from "cn"
import { use } from "react"
import { withUniwind } from "uniwind"
import { TextClassContext } from "#components/text"

function IconPrimitive({ as: Component, ...props }: IconProps & { as: TablerIcon }) {
  return <Component {...props} />
}

const StyledIcon = withUniwind(IconPrimitive, {
  size: { fromClassName: "className", styleProperty: "width" },
  color: { fromClassName: "className", styleProperty: "color" },
})

function Icon({ className, ...props }: IconProps & { as: TablerIcon; className?: string }) {
  const textClass = use(TextClassContext)
  return <StyledIcon className={cn("size-5 text-foreground", textClass, className)} {...props} />
}

export { Icon }
