import { useState } from "react"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { auth, describeAuthError } from "@/lib/auth"
import { useCompleteAuth } from "@/routes/auth/use-complete-auth"

const route = getRouteApi("/login")

export type LoginStep = "email" | "password" | "code"

export function useLoginPage() {
  const search = route.useSearch()
  const navigate = useNavigate()
  const destination = { invitationId: search.invitationId, redirect: search.redirect }
  const completeAuth = useCompleteAuth(destination)
  const [step, setStep] = useState<LoginStep>("email")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState<"password" | "code" | null>(null)
  return {
    destination,
    step,
    email,
    password,
    error,
    pending,
    setEmail: (value: string) => setEmail(value),
    setPassword: (value: string) => setPassword(value),
    back: () => {
      setError("")
      setStep(step === "code" ? "password" : "email")
    },
    continueWithEmail: () => {
      if (!email.includes("@")) {
        setError("Enter a valid email address.")
        return
      }
      setError("")
      setStep("password")
    },
    signIn: async () => {
      setError("")
      setPending("password")
      const result = await auth.signIn.email({ email, password })
      if (result.error === null) {
        await completeAuth()
        return
      }
      setPending(null)
      const failure = describeAuthError(result.error)
      if (failure.code === "EMAIL_NOT_VERIFIED") {
        await navigate({ to: "/verify-email", search: { ...destination, email } })
        return
      }
      setError(failure.message)
    },
    sendCode: async () => {
      setError("")
      setPending("code")
      const result = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
      setPending(null)
      if (result.error === null) {
        setStep("code")
        return
      }
      setError(describeAuthError(result.error).message)
    },
    verifyCode: async (otp: string) => {
      const result = await auth.signIn.emailOtp({ email, otp })
      if (result.error !== null) return describeAuthError(result.error)
      await completeAuth()
      return
    },
    resendCode: async () => {
      const result = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
      return result.error === null ? undefined : describeAuthError(result.error)
    },
  }
}
