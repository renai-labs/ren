import { Channel } from "@ren/schema/channel"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { useQuery } from "@tanstack/react-query"
import { Auth } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { CompleteAuth } from "./complete-auth.js"

const slackSetup = "/settings/channels/slack?connect=true"

const glyphs = { github: "Github", slack: "Slack" } as const

export function SocialButton(props: { provider: "github" | "slack"; destination: CompleteAuth.Destination }) {
  const context = RouterContext.useRouterContext()
  const auth = Auth.useClient()
  const platform = Platform.usePlatform()
  const offered = useQuery({
    ...context.api["sign-in"]["sign-in-provider"].list.queryOptions(),
    select: (providers) => providers.items.includes(props.provider),
  })
  if (!offered.data) return null
  const destination =
    props.provider === "slack"
      ? { ...props.destination, redirect: props.destination.redirect ?? slackSetup }
      : props.destination
  const afterAuth = `${platform.appUrl}${CompleteAuth.href({ ...destination, join: true })}`
  return (
    <Button
      appearance="secondary"
      size="large"
      width="full"
      leadingIcon={<Icon glyph={glyphs[props.provider]} size="small" />}
      onClick={() =>
        void auth.signIn.social({ provider: props.provider, callbackURL: afterAuth, newUserCallbackURL: afterAuth })
      }
    >
      Continue with {Channel.titles[props.provider]}
    </Button>
  )
}
