import { LogomarkShape } from "@ren/util/logomark-shape"

function LoadingMark() {
  return (
    <svg viewBox={LogomarkShape.viewBox} fill="none" aria-hidden="true" className="h-9 w-auto text-foreground/10">
      {LogomarkShape.paths.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
      <path d={LogomarkShape.paths[2]} fill="currentColor" className="animate-logo-progress text-muted-foreground" />
    </svg>
  )
}

export function AppBoot() {
  return (
    <output aria-label="Loading Ren…" className="flex min-h-svh items-center justify-center bg-background">
      <LoadingMark />
    </output>
  )
}
