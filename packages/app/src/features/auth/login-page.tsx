import { AuthError, AuthForm } from "@ren/client"
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router"
import { IconMail } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { FieldGroup } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import {
  AuthField,
  AuthLayout,
  BackButton,
  CodeVerification,
  EmailSummary,
  FormError,
  GoogleButton,
  PasswordInput,
  SocialButton,
} from "../../components/auth-layout.js"
import { useRef, useState } from "react"
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
  const emailInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<LoginStep>("email")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [emailError, setEmailError] = useState("")
  const [passwordError, setPasswordError] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState<"password" | "code" | null>(null)
  const back = () => {
    setError("")
    setPasswordError("")
    setStep("email")
  }
  const checkEmail = () => {
    const failure = AuthForm.emailError(email)
    setEmailError(failure)
    if (failure) emailInput.current?.focus()
    return failure === ""
  }
  const continueWithEmail = () => {
    setError("")
    if (checkEmail()) setStep("password")
  }
  const signIn = async () => {
    setPasswordError("")
    setPending("password")
    const result = await auth.signIn.email({ email, password })
    if (result.error === null) {
      await completeAuth()
      return
    }
    setPending(null)
    const failure = AuthError.describe(result.error)
    if (failure.code === "EMAIL_NOT_VERIFIED") {
      await navigate({ to: "/verify-email", search: { ...destination, email } })
      return
    }
    setPasswordError(failure.message)
    requestAnimationFrame(() => passwordInput.current?.select())
  }
  const sendCode = async () => {
    setError("")
    if (!checkEmail()) return
    setPending("code")
    const result = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
    setPending(null)
    if (result.error === null) {
      setStep("code")
      return
    }
    setError(AuthError.describe(result.error).message)
  }
  const verifyCode = async (otp: string) => {
    const result = await auth.signIn.emailOtp({ email, otp })
    if (result.error !== null) return AuthError.describe(result.error)
    await completeAuth()
    return
  }
  const resendCode = async () => {
    const result = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
    return result.error === null ? undefined : AuthError.describe(result.error)
  }
  if (step === "code")
    return (
      <AuthLayout title="Check your email" description="">
        <CodeVerification email={email} verify={verifyCode} resend={resendCode} />
        <BackButton onClick={back} />
      </AuthLayout>
    )
  if (step === "password")
    return (
      <AuthLayout title="Enter your password" description="">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void signIn()
          }}
        >
          <FieldGroup className="gap-4">
            <EmailSummary email={email} onChange={back} />
            <AuthField
              id="login-password"
              label="Password"
              error={passwordError}
              labelAction={
                <Link
                  to="/forgot-password"
                  search={{ email }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Forgot your password?
                </Link>
              }
            >
              {(control) => (
                <PasswordInput
                  {...control}
                  ref={passwordInput}
                  autoComplete="current-password"
                  placeholder="Your password"
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
                  autoFocus
                  required
                  value={password}
                  onChange={(event) => {
                    setPassword(event.currentTarget.value)
                    setPasswordError("")
                  }}
                  disabled={pending !== null}
                />
              )}
            </AuthField>
            <Button type="submit" className="h-10 w-full" disabled={pending !== null}>
              {pending === "password" ? <Spinner data-icon="inline-start" /> : null}
              {pending === "password" ? "Signing in…" : "Sign in"}
            </Button>
          </FieldGroup>
        </form>
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
      <div className="flex flex-col gap-2">
        <GoogleButton destination={destination} />
        <SocialButton provider="github" destination={destination} />
        <SocialButton provider="slack" destination={destination} />
      </div>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          continueWithEmail()
        }}
      >
        <FieldGroup className="gap-4">
          <FormError>{error}</FormError>
          <AuthField id="login-email" label="Email" error={emailError}>
            {(control) => (
              <Input
                {...control}
                ref={emailInput}
                className="h-10 bg-card dark:bg-card"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
                autoFocus
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.currentTarget.value)
                  setEmailError("")
                }}
              />
            )}
          </AuthField>
          <div className="flex flex-col gap-2">
            <Button type="submit" className="h-10 w-full" disabled={pending !== null}>
              Continue
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-10 w-full"
              disabled={pending !== null}
              onClick={() => void sendCode()}
            >
              {pending === "code" ? <Spinner data-icon="inline-start" /> : <IconMail data-icon="inline-start" />}
              Email me a sign-in code
            </Button>
          </div>
        </FieldGroup>
      </form>
    </AuthLayout>
  )
}
