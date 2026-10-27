import { useNavigate } from "@tanstack/react-router"
import { authorizationQuery, continueAuthorization, destinationHref, type Destination } from "@/lib/auth"
import { resetSession } from "@/lib/chat"

export function useCompleteAuth(destination: Destination, options?: { readonly continueAuthorization?: boolean }) {
  const navigate = useNavigate()
  return async () => {
    if (authorizationQuery) {
      if (options?.continueAuthorization === true) await continueAuthorization()
      return
    }
    resetSession()
    await navigate({ href: destinationHref({ ...destination, join: true }) })
  }
}
