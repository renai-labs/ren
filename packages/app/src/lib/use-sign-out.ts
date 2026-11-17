import { useNavigate } from "@tanstack/react-router"
import { resetSession } from "./chat.js"
import { RouterContext } from "./router-context.js"

export function useSignOut() {
  const { auth, platform, queryClient } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  return async () => {
    await auth.signOut()
    platform.analytics?.reset()
    await platform.chatCache?.forget()
    resetSession(queryClient)
    await navigate({ to: "/login" })
  }
}
