import { logomarkPaths } from "../icons/logomark-paths.js"

function LoadingMark() {
  return (
    <svg viewBox="0 0 876 1003" fill="none" aria-hidden="true" className="h-9 w-auto text-foreground/10">
      {logomarkPaths.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
      <path d={logomarkPaths[2]} fill="currentColor" className="animate-logo-progress text-muted-foreground" />
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
