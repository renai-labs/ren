import { useId } from "react"
import type { ComponentProps } from "react"

type GlyphProps = Omit<ComponentProps<"svg">, "stroke"> & { stroke?: string | number }

const bars = [
  { x: 1.5, y: 8, height: 6 },
  { x: 6.5, y: 5, height: 9 },
  { x: 11.5, y: 2, height: 12 },
]

function SignalBars(props: { level: number; attributes: GlyphProps }) {
  return (
    <svg viewBox="0 0 16 16" {...props.attributes} stroke={undefined}>
      {bars.map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={props.level === 0 ? 7.25 : bar.y}
          width="3"
          height={props.level === 0 ? 1.5 : bar.height}
          rx={props.level === 0 ? 0.5 : 1}
          fill="currentColor"
          className={props.level > 0 && index >= props.level ? "opacity-disabled" : undefined}
        />
      ))}
    </svg>
  )
}

function ProgressRing(props: { state: "empty" | "half" | "complete" | "dismissed"; attributes: GlyphProps }) {
  const maskId = useId()
  if (props.state === "complete" || props.state === "dismissed") {
    return (
      <svg viewBox="-1 -1 16 16" data-state={props.state} {...props.attributes} stroke={undefined}>
        <mask id={maskId}>
          <circle cx="7" cy="7" r="7" fill="white" />
          <path
            d={props.state === "complete" ? "M4 7.2 5.9 9.1 10 5" : "M4.75 4.75 9.25 9.25M9.25 4.75 4.75 9.25"}
            fill="none"
            stroke="black"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
        <circle cx="7" cy="7" r="7" fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    )
  }
  return (
    <svg viewBox="-1 -1 16 16" data-state={props.state} {...props.attributes} stroke={undefined}>
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {props.state === "half" ? (
        <circle
          cx="7"
          cy="7"
          r="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={`${2 * Math.PI} ${4 * Math.PI}`}
          transform="rotate(-90 7 7)"
        />
      ) : null}
    </svg>
  )
}

export function ProgressEmpty(props: GlyphProps) {
  return <ProgressRing state="empty" attributes={props} />
}

export function ProgressHalf(props: GlyphProps) {
  return <ProgressRing state="half" attributes={props} />
}

export function ProgressComplete(props: GlyphProps) {
  return <ProgressRing state="complete" attributes={props} />
}

export function ProgressDismissed(props: GlyphProps) {
  return <ProgressRing state="dismissed" attributes={props} />
}

export function SignalNone(props: GlyphProps) {
  return <SignalBars level={0} attributes={props} />
}

export function SignalLow(props: GlyphProps) {
  return <SignalBars level={1} attributes={props} />
}

export function SignalMedium(props: GlyphProps) {
  return <SignalBars level={2} attributes={props} />
}

export function SignalHigh(props: GlyphProps) {
  return <SignalBars level={3} attributes={props} />
}

export function UnassignedPerson(props: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" {...props} stroke={undefined}>
      <circle
        cx="8"
        cy="8"
        r="7.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="2.2 1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="6.6" r="2.2" fill="currentColor" />
      <path
        d="M4.4 12.4a4.3 4.3 0 0 1 7.2 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Linear(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props} stroke={undefined}>
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.886 4.18ZM1.817 5.626l16.557 16.557c-.338.212-.687.408-1.046.585L1.232 6.671c.177-.36.373-.709.585-1.045ZM.322 8.489l15.19 15.19c-.487.152-.987.276-1.498.367L.006 10.288A12.02 12.02 0 0 1 .322 8.49ZM0 12.594l11.406 11.404c-.487-.008-.965-.05-1.436-.126L.126 14.03A12.09 12.09 0 0 1 0 12.594Z" />
    </svg>
  )
}
