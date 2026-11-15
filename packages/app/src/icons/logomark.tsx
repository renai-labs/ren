import { LogomarkShape } from "@ren/util/logomark-shape"

export function Logomark(props: { className?: string | undefined; outline?: boolean | undefined }) {
  return (
    <svg
      viewBox={props.outline ? LogomarkShape.outlineViewBox : LogomarkShape.viewBox}
      fill="none"
      aria-hidden
      className={props.className}
    >
      {LogomarkShape.paths.map((d) => (
        <path
          key={d}
          d={d}
          fill={props.outline ? "none" : "currentColor"}
          stroke={props.outline ? "currentColor" : undefined}
          strokeWidth={props.outline ? 3 : undefined}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
