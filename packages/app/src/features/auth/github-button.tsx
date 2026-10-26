import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { useQuery } from "@tanstack/react-query"
import { Auth } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { CompleteAuth } from "./complete-auth.js"

export function GitHubButton(props: { destination: CompleteAuth.Destination }) {
  const context = RouterContext.useRouterContext()
  const auth = Auth.useClient()
  const platform = Platform.usePlatform()
  const offered = useQuery({
    ...context.api["sign-in"]["sign-in-provider"].list.queryOptions(),
    select: (providers) => providers.items.includes("github"),
  })
  if (!offered.data) return null
  const afterAuth = `${platform.appUrl}${CompleteAuth.href({ ...props.destination, join: true })}`
  return (
    <Button
      appearance="secondary"
      size="large"
      width="full"
      leadingIcon={<Icon glyph="Github" size="small" />}
      onClick={() =>
        void auth.signIn.social({ provider: "github", callbackURL: afterAuth, newUserCallbackURL: afterAuth })
      }
    >
      Continue with GitHub
    </Button>
  )
}
