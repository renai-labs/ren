import { PublicShell } from "@ren/ui/public-shell"
import { useState } from "react"
import { AuthFlowLayout, LegalFooter } from "./auth-flow-layout.js"
import type { CompleteAuth } from "./complete-auth.js"
import { SignupDetails } from "./signup-details.js"
import { SignupPassword } from "./signup-password.js"

export function Signup(props: { destination: CompleteAuth.Destination; title?: string; description?: string }) {
  const [details, setDetails] = useState<{ name: string; email: string }>()
  const [step, setStep] = useState<"details" | "password">("details")
  const [emailError, setEmailError] = useState("")
  return (
    <AuthFlowLayout title={props.title} description={props.description} footer={<LegalFooter purpose="signup" />}>
      <PublicShell.Step key={step}>
        {step === "password" && details !== undefined ? (
          <SignupPassword
            destination={props.destination}
            details={details}
            onBack={() => setStep("details")}
            onEmailRejected={(message) => {
              setEmailError(message)
              setStep("details")
            }}
          />
        ) : (
          <SignupDetails
            destination={props.destination}
            defaults={details}
            emailError={emailError}
            onContinue={(next) => {
              setEmailError("")
              setDetails(next)
              setStep("password")
            }}
          />
        )}
      </PublicShell.Step>
    </AuthFlowLayout>
  )
}
