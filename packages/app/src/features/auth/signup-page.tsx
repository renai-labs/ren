import { Link, getRouteApi, useNavigate } from "@tanstack/react-router"
import { Button } from "@ren/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import {
  AuthLayout,
  BackButton,
  FormError,
  GoogleButton,
  PasswordInput,
  SocialButton,
} from "../../components/auth-layout.js"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { describeAuthError } from "../../lib/auth.js"
import { useCompleteAuth } from "./use-complete-auth.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/signup")

const emailRejections = new Set(["DISPOSABLE_EMAIL", "UNDELIVERABLE_EMAIL_DOMAIN", "ALIAS_EMAIL"])

function PasswordStep(props: {
  email: string
  password: string
  onPasswordChange: (password: string) => void
  error: string
  pending: boolean
  onSubmit: () => void
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
    >
      <FieldGroup className="gap-4">
        <FormError>{props.error}</FormError>
        <Field>
          <FieldLabel htmlFor="signup-email">Email</FieldLabel>
          <Input
            id="signup-email"
            type="email"
            value={props.email}
            readOnly
            className="h-10 border-transparent bg-muted dark:bg-muted"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="signup-password">Password</FieldLabel>
          <PasswordInput
            id="signup-password"
            autoComplete="new-password"
            placeholder="Create a password"
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
            autoFocus
            required
            value={props.password}
            disabled={props.pending}
            onChange={(event) => props.onPasswordChange(event.currentTarget.value)}
          />
          <FieldDescription>At least 8 characters</FieldDescription>
        </Field>
        <Button type="submit" className="h-10 w-full" disabled={props.pending}>
          {props.pending ? <Spinner data-icon="inline-start" /> : null}
          {props.pending ? "Creating account…" : "Continue"}
        </Button>
      </FieldGroup>
    </form>
  )
}

export function SignupPage() {
  const { api, auth } = RouterContext.useRouterContext()
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
  const title = organizationName ? `Join ${organizationName}` : undefined
  const description = organizationName ? "Create your Ren account" : undefined
  const back = () => {
    setError("")
    setStep("details")
  }
  const continueWithDetails = () => {
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
  }
  const createAccount = async () => {
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
  }
  if (step === "password")
    return (
      <AuthLayout title={title} description={description} legal="signup">
        <PasswordStep
          email={email}
          password={password}
          onPasswordChange={setPassword}
          error={error}
          pending={pending}
          onSubmit={() => void createAccount()}
        />
        <BackButton onClick={back} />
      </AuthLayout>
    )
  return (
    <AuthLayout
      title={title}
      description={description}
      legal="signup"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" search={destination}>
            Sign in
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
          continueWithDetails()
        }}
      >
        <FieldGroup className="gap-4">
          <FormError>{error}</FormError>
          <Field>
            <FieldLabel htmlFor="signup-name">Name</FieldLabel>
            <Input
              className="h-10 bg-card dark:bg-card"
              id="signup-name"
              autoComplete="name"
              placeholder="Maya Chen"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
              autoFocus={!emailError}
              required
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </Field>
          <Field data-invalid={emailError !== "" || undefined}>
            <FieldLabel htmlFor="signup-email">Email</FieldLabel>
            <Input
              className="h-10 bg-card dark:bg-card"
              id="signup-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
              autoFocus={emailError !== ""}
              required
              aria-invalid={emailError !== "" || undefined}
              value={email}
              onChange={(event) =>
                ((value: string) => {
                  setEmail(value)
                  setEmailError("")
                })(event.currentTarget.value)
              }
            />
            {emailError ? <FieldError>{emailError}</FieldError> : null}
          </Field>
          <Button type="submit" className="h-10 w-full">
            Continue
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  )
}
