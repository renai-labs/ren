import { BrandMarks } from "@ren/util/brand-marks"
import { cn } from "cn"
import { use } from "react"
import Svg, { Path, type SvgProps } from "react-native-svg"
import { withUniwind } from "uniwind"
import { TextClassContext } from "#components/text"

const StyledSvg = withUniwind(Svg, {
  width: { fromClassName: "className", styleProperty: "width" },
  height: { fromClassName: "className", styleProperty: "height" },
  color: { fromClassName: "className", styleProperty: "color" },
})

function BrandMark(props: { readonly mark: BrandMarks.Mark; readonly className?: string }) {
  const textClass = use(TextClassContext)
  return (
    <StyledSvg
      viewBox={props.mark.viewBox}
      aria-hidden
      className={cn("size-4 text-foreground", textClass, props.className)}
    >
      {props.mark.paths.map((path) => (
        <Path key={path.d} d={path.d} fill={path.fill ?? "currentColor"} />
      ))}
    </StyledSvg>
  )
}

function GitHubIcon(props: SvgProps) {
  return (
    <Svg viewBox={BrandMarks.github.viewBox} fill="currentColor" aria-hidden {...props}>
      {BrandMarks.github.paths.map((path) => (
        <Path key={path.d} d={path.d} />
      ))}
    </Svg>
  )
}

export { BrandMark, GitHubIcon }
