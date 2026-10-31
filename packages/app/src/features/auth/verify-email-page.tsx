import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { AuthLayout, BackButton, CodeVerification } from "../../components/auth-layout.js"
import { describeAuthError } from "../../lib/auth.js"
import { useCompleteAuth } from "./use-complete-auth.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/verify-email")

export function VerifyEmailPage() {
  const { auth } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = useNavigate()
  const destination = { invitationId: search.invitationId, redirect: search.redirect }
  const completeAuth = useCompleteAuth(destination, { continueAuthorization: true })
  const email = search.email ?? ""
  const verify = async (otp: string) => {
    const result = await auth.emailOtp.verifyEmail({ email, otp })
    if (result.error !== null) return describeAuthError(result.error)
    await completeAuth()
    return
  }
  const resend = async () => {
    const result = await auth.emailOtp.sendVerificationOtp({ email, type: "email-verification" })
    return result.error === null ? undefined : describeAuthError(result.error)
  }
  const back = () => void navigate({ to: "/login", search: destination })
  return (
    <AuthLayout>
      <CodeVerification email={email} verify={verify} resend={resend} />
      <BackButton onClick={back}>Back to sign in</BackButton>
    </AuthLayout>
  )
}
