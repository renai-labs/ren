import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { AuthLayout, BackButton, CodeVerification } from "@/components/ren/auth"
import { auth, describeAuthError } from "@/lib/auth"
import { useCompleteAuth } from "@/routes/auth/use-complete-auth"

const route = getRouteApi("/verify-email")

function useVerifyEmailPage() {
  const search = route.useSearch()
  const navigate = useNavigate()
  const destination = { invitationId: search.invitationId, redirect: search.redirect }
  const completeAuth = useCompleteAuth(destination, { continueAuthorization: true })
  const email = search.email ?? ""
  return {
    email,
    verify: async (otp: string) => {
      const result = await auth.emailOtp.verifyEmail({ email, otp })
      if (result.error !== null) return describeAuthError(result.error)
      await completeAuth()
      return
    },
    resend: async () => {
      const result = await auth.emailOtp.sendVerificationOtp({ email, type: "email-verification" })
      return result.error === null ? undefined : describeAuthError(result.error)
    },
    back: () => void navigate({ to: "/login", search: destination }),
  }
}

export function VerifyEmailPage() {
  const page = useVerifyEmailPage()
  return (
    <AuthLayout>
      <CodeVerification email={page.email} verify={page.verify} resend={page.resend} />
      <BackButton onClick={page.back}>Back to sign in</BackButton>
    </AuthLayout>
  )
}
