import { useNavigate } from "@tanstack/react-router"
import { continueAuthorization, destinationHref, type Destination } from "../../lib/auth.js"
import { resetSession } from "../../lib/chat.js"
import { RouterContext } from "../../lib/router-context.js"

export function useCompleteAuth(destination: Destination, options?: { readonly continueAuthorization?: boolean }) {
  const { auth, platform, queryClient } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  return async () => {
    if (platform.authorizationQuery) {
      if (options?.continueAuthorization === true) await continueAuthorization(auth)
      return
    }
    resetSession(queryClient)
    await navigate({ href: destinationHref({ ...destination, join: true }) })
  }
}
