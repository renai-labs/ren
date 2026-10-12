import { Avatar } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import type { Glyph } from "@ren/ui/icon"
import { PublicShell } from "@ren/ui/public-shell"
import { Text } from "@ren/ui/text"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

export function InvitationStateCard(props: { glyph: Glyph; title: string; description: string; action?: ReactNode }) {
  return (
    <PublicShell.Centered>
      <div className="flex flex-col gap-6 text-center">
        <div className="flex justify-center">
          <Avatar.Root name={props.title} glyph={props.glyph} size="extra-large" decorative />
        </div>
        <div className="flex flex-col gap-2">
          <Text purpose="title" alignment="center">
            {props.title}
          </Text>
          <Text tone="secondary" alignment="center">
            {props.description}
          </Text>
        </div>
        <div className="flex flex-col gap-3">
          {props.action}
          <Button appearance="primary" width="full" render={<Link to="/" />}>
            Return to homepage
          </Button>
        </div>
      </div>
    </PublicShell.Centered>
  )
}
