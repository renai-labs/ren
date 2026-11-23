import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { IconArrowUpRight, IconGauge, IconX } from "@tabler/icons-react"
import { LimitBanners } from "@ren/chat"
import { Alert, AlertAction, AlertDescription } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import type { SessionMessage } from "@ren/schema/session/message"
import { RouterContext } from "../../lib/router-context.js"

const refreshEvery = 60_000

// oxlint-disable-next-line ren/no-comments -- Providers P21: the banner is not saved. A dismissed step stays dismissed while the app runs.
const dismissed = new Set<string>()

// oxlint-disable-next-line ren/no-comments -- Providers §9.3: read when the chat opens, every 60 s while it is open, and after each turn: keyed by the chat's last finished turn, the banner mounts again and refetches.
export function LimitBanner(props: {
  sessionId: string
  messages: ReadonlyArray<SessionMessage.Info>
  admin: boolean
}) {
  return (
    <Banner
      key={props.messages.findLast((message) => message.type === "idle")?.id}
      sessionId={props.sessionId}
      admin={props.admin}
    />
  )
}

function Banner(props: { sessionId: string; admin: boolean }) {
  const { api } = RouterContext.useRouterContext()
  const limits = useQuery({
    ...api.limits.get.queryOptions({ id: props.sessionId }),
    staleTime: 0,
    refetchInterval: refreshEvery,
  })
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(dismissed))
  const banner = LimitBanners.next({ chat: props.sessionId, meters: limits.data?.meters ?? [], dismissed: hidden })
  if (!banner) return null
  return (
    <Alert className="py-3 pr-40">
      <IconGauge />
      <AlertDescription className="text-foreground">{banner.text}</AlertDescription>
      <AlertAction className="top-1/2 flex -translate-y-1/2 items-center gap-1">
        {banner.action === "billing" && props.admin ? (
          <Link to="/settings/billing" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Add credits
            <IconArrowUpRight data-icon="inline-end" />
          </Link>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          onClick={() => {
            dismissed.add(banner.id)
            setHidden(new Set(dismissed))
          }}
        >
          <IconX />
        </Button>
      </AlertAction>
    </Alert>
  )
}
