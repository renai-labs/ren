import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import type { ReactElement, ReactNode } from "react"

export function BackLink(props: { onClick?: () => void; render?: ReactElement; children?: ReactNode }) {
  return (
    <div className="flex justify-center">
      <Button
        variant="ghost"
        className="text-muted-foreground"
        nativeButton={props.render === undefined}
        render={props.render}
        onClick={props.onClick}
      >
        <Icon glyph="ChevronLeft" data-icon="inline-start" />
        {props.children ?? "Go back"}
      </Button>
    </div>
  )
}
