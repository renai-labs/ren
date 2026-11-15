import { LogomarkShape } from "@ren/util/logomark-shape"
import { cn } from "cn"
import Svg, { Path } from "react-native-svg"
import { withUniwind } from "uniwind"

const StyledSvg = withUniwind(Svg, {
  width: { fromClassName: "className", styleProperty: "width" },
  height: { fromClassName: "className", styleProperty: "height" },
  color: { fromClassName: "className", styleProperty: "color" },
})

function Logomark(props: { readonly className?: string; readonly outline?: boolean }) {
  const outline = props.outline === true
  return (
    <StyledSvg
      viewBox={outline ? LogomarkShape.outlineViewBox : LogomarkShape.viewBox}
      fill="none"
      aria-hidden
      className={cn("size-6 text-foreground", props.className)}
    >
      {LogomarkShape.paths.map((d) => (
        <Path
          key={d}
          d={d}
          strokeLinejoin="round"
          {...(outline ? { fill: "none", stroke: "currentColor", strokeWidth: 3 } : { fill: "currentColor" })}
        />
      ))}
    </StyledSvg>
  )
}

export { Logomark }
