import { BrandMarks } from "@ren/util/brand-marks"
import type { ComponentProps } from "react"

type MarkProps = ComponentProps<"svg">

export function GitMark(props: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187" />
    </svg>
  )
}

export function LinearMark(props: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
    </svg>
  )
}

const paths = (mark: BrandMarks.Mark) =>
  mark.paths.map((path) => <path key={path.d} fill={path.fill ?? "currentColor"} d={path.d} />)

export function GitHubMark(props: MarkProps) {
  return (
    <svg viewBox={BrandMarks.github.viewBox} aria-hidden {...props}>
      {paths(BrandMarks.github)}
    </svg>
  )
}

export function SlackMark(props: MarkProps) {
  return (
    <svg viewBox={BrandMarks.slack.viewBox} aria-hidden {...props}>
      {paths(BrandMarks.slack)}
    </svg>
  )
}

export function GoogleMark(props: MarkProps) {
  return (
    <svg viewBox={BrandMarks.google.viewBox} aria-hidden {...props}>
      {paths(BrandMarks.google)}
    </svg>
  )
}

export function NotionMark(props: MarkProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.333}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="1.667" y="1.667" width="12.667" height="12.667" rx="2.5" />
      <path d="M5.5 11.5V4.5L10.5 11.5V4.5" />
    </svg>
  )
}
