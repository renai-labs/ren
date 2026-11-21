import { cn } from "cn"
import { use, type ComponentType } from "react"
import type { NumberProp, SvgProps } from "react-native-svg"
import { withUniwind } from "uniwind"
import { TextClassContext } from "#components/text"

type IconProps = SvgProps & { size?: NumberProp }

function IconPrimitive({ as: Component, ...props }: IconProps & { as: ComponentType<IconProps> }) {
  return <Component {...props} />
}

const StyledIcon = withUniwind(IconPrimitive, {
  style: { fromClassName: "className" },
  size: { fromClassName: "className", styleProperty: "width" },
  color: { fromClassName: "className", styleProperty: "color" },
})

function Icon({ className, ...props }: IconProps & { as: ComponentType<IconProps>; className?: string }) {
  const textClass = use(TextClassContext)
  return <StyledIcon className={cn("size-5 text-foreground", textClass, className)} {...props} />
}

export { Icon }
