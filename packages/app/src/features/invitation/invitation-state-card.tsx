import { Avatar, AvatarFallback } from "@ren/ui/avatar"
import { buttonVariants } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
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
          <Avatar className="size-14">
            <AvatarFallback>
              <Icon glyph={props.glyph} size="extra-large" />
            </AvatarFallback>
          </Avatar>
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
          <Link to="/" className={buttonVariants({ className: "w-full" })}>
            Return to homepage
          </Link>
        </div>
      </div>
    </PublicShell.Centered>
  )
}
