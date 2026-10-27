import type { SVGProps } from "react"

type IconProps = { size?: number; color?: string } & Omit<SVGProps<SVGSVGElement>, "color">

const stroke = (color: string, width = 2) => ({
  fill: "none",
  stroke: color,
  strokeWidth: width,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
})

const base = { xmlns: "http://www.w3.org/2000/svg", className: "inline-block shrink-0" }

export function EmptyCircle({ size = 14 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} viewBox="-1 -1 16 16" aria-hidden>
      <circle cx="7" cy="7" r="6" fill="none" stroke="var(--f-text-2)" strokeWidth="1.5" />
    </svg>
  )
}

export function HeaderCircle() {
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--f-text-2)" strokeWidth="1.3" />
    </svg>
  )
}

export function HalfCircle({ color }: { color: string }) {
  return (
    <svg {...base} width="14" height="14" viewBox="-1 -1 16 16" aria-hidden>
      <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="M7 3a4 4 0 0 1 0 8z" fill={color} />
    </svg>
  )
}

export function ThreeQuarterCircle({ color }: { color: string }) {
  return (
    <svg {...base} width="14" height="14" viewBox="-1 -1 16 16" aria-hidden>
      <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.5" />
      <path d="M7 3a4 4 0 1 1 -4 4h4z" fill={color} />
    </svg>
  )
}

export function Hand({ size = 14, color = "var(--f-amber)" }: IconProps) {
  const s = stroke(color)
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5" {...s} />
      <path d="M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5" {...s} />
      <path d="M14 5.5a1.5 1.5 0 0 1 3 0v6.5" {...s} />
      <path
        d="M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1 -6 6h-2a6 6 0 0 1 -5 -2.7c-.3 -.5 -1.4 -2.4 -3.3 -5.7a1.5 1.5 0 0 1 .5 -2a1.9 1.9 0 0 1 2.3 .3l1.5 1.5"
        {...s}
      />
    </svg>
  )
}

export function Clock() {
  const s = stroke("var(--f-text-2)")
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 24 24" aria-hidden>
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" {...s} />
      <path d="M12 7v5l3 3" {...s} />
    </svg>
  )
}

export function Dollar() {
  const s = stroke("var(--f-text-2)")
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 24 24" aria-hidden>
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" {...s} />
      <path d="M14.8 9a2 2 0 0 0 -1.8 -1h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1 -1.8 -1" {...s} />
      <path d="M12 7v10" {...s} />
    </svg>
  )
}

export function Tokens() {
  const s = stroke("var(--f-text-2)")
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 24 24" aria-hidden>
      <path d="M17.5 15.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0" {...s} />
      <path d="M3 19v-10.5a3.5 3.5 0 0 1 7 0v10.5" {...s} />
      <path d="M3 13h7" {...s} />
      <path d="M21 12v7" {...s} />
    </svg>
  )
}

export function ArrowRight({ size = 13 }: IconProps) {
  const s = stroke("var(--f-ink)")
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M5 12l14 0" {...s} />
      <path d="M13 18l6 -6" {...s} />
      <path d="M13 6l6 6" {...s} />
    </svg>
  )
}

export function ArrowUp() {
  const s = stroke("var(--f-ink)")
  return (
    <svg {...base} width="13" height="13" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 19V5" {...s} />
      <path d="M6 11l6 -6l6 6" {...s} />
    </svg>
  )
}

export function Check({ size = 13 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M5 12l5 5l10 -10" {...stroke("var(--f-ink)")} />
    </svg>
  )
}

export function Merge() {
  const s = stroke("var(--f-ink)")
  return (
    <svg {...base} width="13" height="13" viewBox="0 0 24 24" aria-hidden>
      <path d="M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...s} />
      <path d="M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...s} />
      <path d="M15 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...s} />
      <path d="M7 8v8" {...s} />
      <path d="M7 8a4 4 0 0 0 4 4h4" {...s} />
    </svg>
  )
}

export function Key() {
  const s = stroke("var(--f-ink)")
  return (
    <svg {...base} width="13" height="13" viewBox="0 0 24 24" aria-hidden>
      <path d="M16.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" {...s} />
      <path
        d="M14 3a7 7 0 0 1 7 7a7 7 0 0 1 -7 7c-.8 0 -1.6 -.1 -2.3 -.4l-2.7 2.7h-3v3h-3v-3l6.4 -6.4a7 7 0 0 1 4.6 -9.9z"
        {...s}
      />
    </svg>
  )
}

export function ChevronDown({ size = 12 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M6 9l6 6l6 -6" {...stroke("var(--f-text-2)")} />
    </svg>
  )
}

export function PullRequest() {
  const s = stroke("var(--f-success)", 2.2)
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 24 24" aria-hidden>
      <path d="M4 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...s} />
      <path d="M4 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...s} />
      <path d="M16 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" {...s} />
      <path d="M6 8v8" {...s} />
      <path d="M11 6h5a2 2 0 0 1 2 2v8" {...s} />
      <path d="M14 9l-3 -3l3 -3" {...s} />
    </svg>
  )
}

export function LinearLogo() {
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 100 100" aria-hidden>
      <path
        d="M1.2 61.5c-.2-.9.8-1.4 1.5-.8L39.3 97.3c.6.6.1 1.7-.8 1.5C20.4 94.6 5.4 79.6 1.2 61.5zM0 46.9c0 .3.1.6.3.8l52 52c.2.2.5.3.8.3 2.4-.1 4.7-.5 7-1 .8-.2 1-1.1.5-1.7L2.7 39.4c-.6-.6-1.5-.3-1.7.5-.5 2.3-.9 4.6-1 7zM4.2 29.7c-.2.4-.1.9.2 1.2l64.7 64.7c.3.3.8.4 1.2.2 1.8-.8 3.5-1.7 5.1-2.7.6-.3.6-1.1.2-1.6L8.5 24.4c-.5-.5-1.2-.4-1.6.2-1 1.6-1.9 3.3-2.7 5.1zM12.7 17.8c-.4-.4-.4-1 0-1.4C21.8 6.3 35.1 0 50 0c27.6 0 50 22.4 50 50 0 14.9-6.3 28.2-16.4 37.3-.4.4-1 .4-1.4 0L12.7 17.8z"
        fill="var(--f-linear)"
      />
    </svg>
  )
}

export function SentryLogo() {
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M13.9 2.9a2.2 2.2 0 0 0-3.8 0L7 8.3a15.3 15.3 0 0 1 8.4 12.6h-2.2A13.1 13.1 0 0 0 5.9 10.2l-2.9 5a7.5 7.5 0 0 1 4.3 5.7H2.2a.4.4 0 0 1-.3-.5l1.4-2.4a5 5 0 0 0-1.6-.9L.3 19.5a2.2 2.2 0 0 0 .8 3 2.3 2.3 0 0 0 1.1.3h6.9a9.2 9.2 0 0 0-3.8-8.2l1.1-1.9a11.3 11.3 0 0 1 4.8 10.1h5.8a17.1 17.1 0 0 0-7.8-15.5l2.2-3.8a.4.4 0 0 1 .6-.1c.3.1 9.6 16.4 9.8 16.6a.4.4 0 0 1-.4.6h-2.2v1.9h2.2a2.2 2.2 0 0 0 2.2-2.2 2.2 2.2 0 0 0-.3-1.1z"
        fill="var(--f-sentry)"
      />
    </svg>
  )
}

export function SlackLogo() {
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5.04 15.17a2.53 2.53 0 1 1-2.52-2.52h2.52zm1.27 0a2.53 2.53 0 0 1 5.05 0v6.31a2.53 2.53 0 1 1-5.05 0z"
        fill="var(--f-slack-red)"
      />
      <path
        d="M8.83 5.04a2.53 2.53 0 1 1 2.52-2.52v2.52zm0 1.27a2.53 2.53 0 0 1 0 5.05H2.52a2.53 2.53 0 0 1 0-5.05z"
        fill="var(--f-slack-blue)"
      />
      <path
        d="M18.96 8.83a2.53 2.53 0 1 1 2.52 2.52h-2.52zm-1.27 0a2.53 2.53 0 0 1-5.05 0V2.52a2.53 2.53 0 1 1 5.05 0z"
        fill="var(--f-slack-green)"
      />
      <path
        d="M15.17 18.96a2.53 2.53 0 1 1-2.52 2.52v-2.52zm0-1.27a2.53 2.53 0 0 1 0-5.05h6.31a2.53 2.53 0 0 1 0 5.05z"
        fill="var(--f-slack-yellow)"
      />
    </svg>
  )
}

export function RenLogo() {
  const fill = "var(--f-text-2)"
  return (
    <svg {...base} width="11" height="12" viewBox="0 0 876 1003" aria-hidden>
      <path
        d="M674.769 14.612H596.325C544.865 14.612 503.149 56.328 503.149 107.788V691.749C503.149 743.208 544.865 784.925 596.325 784.925H674.769C726.228 784.925 767.944 743.208 767.944 691.749V107.788C767.944 56.328 726.228 14.612 674.769 14.612Z"
        fill={fill}
      />
      <path
        d="M211.519 66.659C226.177 17.332 278.048 -10.774 327.375 3.885L402.569 26.229C451.897 40.887 480.001 92.758 465.343 142.086L299.002 701.859C284.344 751.186 232.473 779.288 183.146 764.631L107.952 742.288C58.624 727.622 30.519 675.756 45.177 626.428L211.519 66.659Z"
        fill={fill}
      />
      <path
        d="M0 965.005C0 944.423 16.687 927.735 37.27 927.735H838.581C859.164 927.735 875.851 944.423 875.851 965.005C875.851 985.588 859.164 1002.28 838.581 1002.28H37.27C16.687 1002.28 0 985.588 0 965.005Z"
        fill={fill}
      />
    </svg>
  )
}

export function Play() {
  return (
    <svg {...base} width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M3.5 2.2v9.6c0 .5.5.8 1 .5l7.6-4.8c.4-.3.4-.8 0-1.1L4.5 1.7c-.5-.3-1 0-1 .5Z" fill="var(--f-text-1)" />
    </svg>
  )
}

export function Pause() {
  return (
    <svg {...base} width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <rect x="3" y="2" width="2.8" height="10" rx="0.8" fill="var(--f-text-1)" />
      <rect x="8.2" y="2" width="2.8" height="10" rx="0.8" fill="var(--f-text-1)" />
    </svg>
  )
}

export function SmallChevronDown() {
  return (
    <svg {...base} width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M2.5 4 5 6.5 7.5 4" {...stroke("var(--f-text-2)", 1.3)} />
    </svg>
  )
}

export function StepBack() {
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M7.5 2.5 4 6l3.5 3.5" {...stroke("var(--f-text-2)", 1.4)} />
    </svg>
  )
}

export function StepForward() {
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M4.5 2.5 8 6 4.5 9.5" {...stroke("var(--f-text-2)", 1.4)} />
    </svg>
  )
}

export function MenuCheck() {
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M2.5 6.2 5 8.5l4.5-5" {...stroke("var(--f-text-1)", 1.4)} />
    </svg>
  )
}
