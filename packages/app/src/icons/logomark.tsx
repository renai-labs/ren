import { logomarkPaths } from "./logomark-paths.js"

export function Logomark(props: { className?: string | undefined; outline?: boolean | undefined }) {
  return (
    <svg
      viewBox={props.outline ? "-3 -3 882 1009" : "0 0 876 1003"}
      fill="none"
      aria-hidden
      className={props.className}
    >
      {logomarkPaths.map((d) => (
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

export function IconRen(props: { className?: string | undefined }) {
  return (
    <svg width="24" height="24" viewBox="0 0 876 1003" fill="currentColor" aria-hidden className={props.className}>
      {logomarkPaths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
