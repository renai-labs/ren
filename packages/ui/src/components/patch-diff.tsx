import type { ReactNode } from "react"
import { PatchDiff as PatchDiffPrimitive } from "@pierre/diffs/react"

function PatchDiff({
  patch,
  theme,
  children,
}: {
  patch: string
  theme: "system" | "light" | "dark"
  children: ReactNode
}) {
  return (
    <PatchDiffPrimitive
      patch={patch}
      className="bg-transparent!"
      // ast-grep-ignore: no-render-props -- @pierre/diffs takes its header as a function
      renderCustomHeader={() => children}
      options={{
        theme: { dark: "pierre-dark", light: "pierre-light" },
        themeType: theme,
        diffStyle: "unified",
        overflow: "wrap",
        lineDiffType: "word",
        unsafeCSS:
          "* { --diffs-bg: var(--background) !important; } [data-diffs-header] { background: transparent !important; padding-inline: 0 !important; }",
      }}
    />
  )
}

export { PatchDiff }
