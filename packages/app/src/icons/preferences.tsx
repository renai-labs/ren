import type { ReactNode } from "react"

type IconProps = { className?: string | undefined }

function Solid(props: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={props.className}>
      {props.children}
    </svg>
  )
}

function Bars(props: IconProps & { start: number; length: number }) {
  return (
    <Solid className={props.className}>
      {[4.25, 9.25, 14.25].map((y) => (
        <rect key={y} x={props.start} y={y} width={props.length} height={1.5} rx={0.75} />
      ))}
    </Solid>
  )
}

export function IconWidthComfortable(props: IconProps) {
  return <Bars start={5} length={10} className={props.className} />
}

export function IconWidthWide(props: IconProps) {
  return <Bars start={2} length={16} className={props.className} />
}

function Activity(props: IconProps & { start: number }) {
  return (
    <Solid className={props.className}>
      <rect x={props.start} y={4} width={6} height={3} rx={1.5} />
      <rect x={2} y={9.5} width={16} height={7} rx={2} />
    </Solid>
  )
}

export function IconActivityLeft(props: IconProps) {
  return <Activity start={2} className={props.className} />
}

export function IconActivityCenter(props: IconProps) {
  return <Activity start={7} className={props.className} />
}

export function IconActivityRight(props: IconProps) {
  return <Activity start={12} className={props.className} />
}

function Letter(props: IconProps & { size: number }) {
  return (
    <Solid className={props.className}>
      <path
        fillRule="evenodd"
        transform={`translate(10 10) scale(${props.size}) translate(-10 -10)`}
        d="M8.6 3h2.8l5.1 14h-2.75l-1.05-3.1H7.3L6.25 17H3.5L8.6 3Zm-.55 8.6h3.9L10 5.85 8.05 11.6Z"
      />
    </Solid>
  )
}

export function IconLetter(props: IconProps) {
  return <Letter size={1} className={props.className} />
}

export function IconLetterSmall(props: IconProps) {
  return <Letter size={0.6} className={props.className} />
}

export function IconLetterMedium(props: IconProps) {
  return <Letter size={0.75} className={props.className} />
}

export function IconLetterLarge(props: IconProps) {
  return <Letter size={0.9} className={props.className} />
}

export function IconLetterLarger(props: IconProps) {
  return <Letter size={1.05} className={props.className} />
}
