import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import type { ReactElement, ReactNode } from "react"

export function BackLink(props: { onClick?: () => void; render?: ReactElement; children?: ReactNode }) {
  return (
    <div className="flex justify-center">
      <Button
        appearance="plain"
        leadingIcon={<Icon glyph="ChevronLeft" size="small" />}
        render={props.render}
        onClick={props.onClick}
      >
        {props.children ?? "Go back"}
      </Button>
    </div>
  )
}
