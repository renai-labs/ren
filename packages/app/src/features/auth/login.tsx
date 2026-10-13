import { PublicShell } from "@ren/ui/public-shell"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"
import { AuthError } from "./auth-error.js"
import { AuthFlowLayout } from "./auth-flow-layout.js"
import { BackLink } from "./back-link.js"
import { CodeVerification } from "./code-verification.js"
import { CompleteAuth } from "./complete-auth.js"
import { LoginEmail } from "./login-email.js"
import { LoginPassword } from "./login-password.js"

export function Login(props: { destination: CompleteAuth.Destination }) {
  const auth = Auth.useClient()
  const completeAuth = CompleteAuth.useCompleteAuth(props.destination)
  const [step, setStep] = useState<"email" | "password" | "code">("email")
  const [email, setEmail] = useState("")
  return (
    <AuthFlowLayout>
      <PublicShell.Step key={step}>
        {step === "email" ? (
          <LoginEmail
            destination={props.destination}
            defaultEmail={email}
            onContinue={(value) => {
              setEmail(value)
              setStep("password")
            }}
          />
        ) : null}
        {step === "password" ? (
          <LoginPassword
            destination={props.destination}
            email={email}
            onBack={() => setStep("email")}
            onCodeSent={() => setStep("code")}
          />
        ) : null}
        {step === "code" ? (
          <>
            <CodeVerification
              email={email}
              verify={async (otp) => {
                const result = await auth.signIn.emailOtp({ email, otp })
                if (result.error !== null) return AuthError.describe(result.error)
                await completeAuth()
                return
              }}
              resend={async () => {
                const result = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
                return result.error === null ? undefined : AuthError.describe(result.error)
              }}
            />
            <BackLink onClick={() => setStep("password")} />
          </>
        ) : null}
      </PublicShell.Step>
    </AuthFlowLayout>
  )
}
