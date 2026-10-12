import { Link } from "@tanstack/react-router"
import { Auth } from "../../lib/auth.js"
import { AuthError } from "./auth-error.js"
import { AuthFlowLayout } from "./auth-flow-layout.js"
import { BackLink } from "./back-link.js"
import { CodeVerification } from "./code-verification.js"
import { CompleteAuth } from "./complete-auth.js"

export function VerifyEmail(props: { email: string; destination: CompleteAuth.Destination }) {
  const auth = Auth.useClient()
  const completeAuth = CompleteAuth.useCompleteAuth(props.destination)
  return (
    <AuthFlowLayout>
      <CodeVerification
        email={props.email}
        verify={async (otp) => {
          const result = await auth.emailOtp.verifyEmail({ email: props.email, otp })
          if (result.error !== null) return AuthError.describe(result.error)
          await completeAuth()
          return undefined
        }}
        resend={async () => {
          const result = await auth.emailOtp.sendVerificationOtp({ email: props.email, type: "email-verification" })
          return result.error === null ? undefined : AuthError.describe(result.error)
        }}
      />
      <BackLink
        render={
          <Link
            to="/login"
            search={{ invitationId: props.destination.invitationId, redirect: props.destination.redirect }}
          />
        }
      >
        Back to sign in
      </BackLink>
    </AuthFlowLayout>
  )
}
