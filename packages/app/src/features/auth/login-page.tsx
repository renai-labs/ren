import { Link, getRouteApi, useNavigate } from "@tanstack/react-router"
import { IconMail } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Field, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import {
  AuthLayout,
  BackButton,
  CodeVerification,
  FormError,
  GoogleButton,
  PasswordInput,
  SocialButton,
} from "../../components/auth-layout.js"
import { useState } from "react"
import { describeAuthError } from "../../lib/auth.js"
import { useCompleteAuth } from "./use-complete-auth.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/login")

export type LoginStep = "email" | "password" | "code"

export function LoginPage() {
  const { auth } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = useNavigate()
  const destination = { invitationId: search.invitationId, redirect: search.redirect }
  const completeAuth = useCompleteAuth(destination)
  const [step, setStep] = useState<LoginStep>("email")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState<"password" | "code" | null>(null)
  const back = () => {
    setError("")
    setStep(step === "code" ? "password" : "email")
  }
  const continueWithEmail = () => {
    if (!email.includes("@")) {
      setError("Enter a valid email address.")
      return
    }
    setError("")
    setStep("password")
  }
  const signIn = async () => {
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
  }
  const sendCode = async () => {
    setError("")
    setPending("code")
    const result = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
    setPending(null)
    if (result.error === null) {
      setStep("code")
      return
    }
    setError(describeAuthError(result.error).message)
  }
  const verifyCode = async (otp: string) => {
    const result = await auth.signIn.emailOtp({ email, otp })
    if (result.error !== null) return describeAuthError(result.error)
    await completeAuth()
    return
  }
  const resendCode = async () => {
    const result = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
    return result.error === null ? undefined : describeAuthError(result.error)
  }
  if (step === "code")
    return (
      <AuthLayout>
        <CodeVerification email={email} verify={verifyCode} resend={resendCode} />
        <BackButton onClick={back} />
      </AuthLayout>
    )
  if (step === "password")
    return (
      <AuthLayout>
        <FormError>{error}</FormError>
        <Button
          type="button"
          variant="secondary"
          className="h-10 w-full"
          disabled={pending !== null}
          onClick={() => void sendCode()}
        >
          {pending === "code" ? <Spinner data-icon="inline-start" /> : <IconMail data-icon="inline-start" />}
          Email sign-in code
        </Button>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void signIn()
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="login-email">Email</FieldLabel>
              <Input
                id="login-email"
                type="email"
                value={email}
                readOnly
                className="h-10 border-transparent bg-muted dark:bg-muted"
              />
            </Field>
            <Field>
              <div className="flex items-center">
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                <Link
                  to="/forgot-password"
                  search={{ email }}
                  className="ml-auto text-sm text-muted-foreground hover:text-foreground"
                >
                  Forgot your password?
                </Link>
              </div>
              <PasswordInput
                id="login-password"
                autoComplete="current-password"
                placeholder="Your password"
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
                autoFocus
                required
                value={password}
                onChange={(event) => ((value: string) => setPassword(value))(event.currentTarget.value)}
                disabled={pending !== null}
              />
            </Field>
            <Button type="submit" className="h-10 w-full" disabled={pending !== null}>
              {pending === "password" ? <Spinner data-icon="inline-start" /> : null}
              {pending === "password" ? "Signing in…" : "Sign in"}
            </Button>
          </FieldGroup>
        </form>
        <BackButton onClick={back} />
      </AuthLayout>
    )
  return (
    <AuthLayout
      footer={
        <>
          Don’t have an account?{" "}
          <Link to="/signup" search={destination}>
            Sign up
          </Link>
        </>
      }
    >
      <GoogleButton destination={destination} />
      <SocialButton provider="github" destination={destination} />
      <SocialButton provider="slack" destination={destination} />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          continueWithEmail()
        }}
      >
        <FieldGroup className="gap-4">
          <FormError>{error}</FormError>
          <Field>
            <FieldLabel htmlFor="login-email">Email</FieldLabel>
            <Input
              className="h-10 bg-card dark:bg-card"
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
              autoFocus
              required
              value={email}
              onChange={(event) => ((value: string) => setEmail(value))(event.currentTarget.value)}
            />
          </Field>
          <Button type="submit" className="h-10 w-full">
            Continue
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  )
}
