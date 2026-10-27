import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { api } from "@/lib/api"
import { auth, describeAuthError } from "@/lib/auth"
import { useCompleteAuth } from "@/routes/auth/use-complete-auth"

const route = getRouteApi("/signup")

const emailRejections = new Set(["DISPOSABLE_EMAIL", "UNDELIVERABLE_EMAIL_DOMAIN", "ALIAS_EMAIL"])

export function useSignupPage() {
  const search = route.useSearch()
  const navigate = useNavigate()
  const destination = { invitationId: search.invitationId, redirect: search.redirect }
  const completeAuth = useCompleteAuth(destination, { continueAuthorization: true })
  const invitation = useQuery({
    ...api.invitation.preview.queryOptions({ id: search.invitationId ?? "" }),
    enabled: Boolean(search.invitationId),
    retry: false,
  })
  const organizationName = invitation.data?.state === "pending" ? invitation.data.organization?.name : undefined
  const [step, setStep] = useState<"details" | "password">("details")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [emailError, setEmailError] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  return {
    destination,
    title: organizationName ? `Join ${organizationName}` : undefined,
    description: organizationName ? "Create your Ren account" : undefined,
    step,
    name,
    email,
    password,
    emailError,
    error,
    pending,
    setName,
    setEmail: (value: string) => {
      setEmail(value)
      setEmailError("")
    },
    setPassword,
    back: () => {
      setError("")
      setStep("details")
    },
    continueWithDetails: () => {
      if (!name.trim()) {
        setError("Enter your name.")
        return
      }
      if (!email.includes("@")) {
        setEmailError("Enter a valid email address.")
        return
      }
      setError("")
      setStep("password")
    },
    createAccount: async () => {
      if (password.length < 8) {
        setError("Use at least 8 characters.")
        return
      }
      setError("")
      setPending(true)
      const result = await auth.signUp.email({ name: name.trim(), email, password })
      if (result.error !== null) {
        setPending(false)
        const failure = describeAuthError(result.error)
        if (emailRejections.has(failure.code)) {
          setEmailError(failure.message)
          setStep("details")
        } else setError(failure.message)
        return
      }
      if (result.data.token === null) {
        await navigate({ to: "/verify-email", search: { ...destination, email } })
        return
      }
      await completeAuth()
    },
  }
}
