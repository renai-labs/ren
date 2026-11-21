import { AuthError, AuthForm } from "@ren/client"
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router"
import { Button } from "@ren/ui/button"
import { FieldGroup } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import {
  AuthField,
  AuthLayout,
  EmailSummary,
  FormError,
  GoogleButton,
  PasswordInput,
  SocialButton,
} from "../../components/auth-layout.js"
import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useCompleteAuth } from "./use-complete-auth.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/signup")

function DetailsStep(props: {
  name: string
  onNameChange: (name: string) => void
  email: string
  onEmailChange: (email: string) => void
  emailError: string
  onEmailError: (error: string) => void
  onContinue: () => void
}) {
  const nameInput = useRef<HTMLInputElement>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const [nameError, setNameError] = useState("")
  const submit = () => {
    const nameFailure = AuthForm.nameError(props.name)
    const emailFailure = AuthForm.emailError(props.email)
    setNameError(nameFailure)
    props.onEmailError(emailFailure)
    if (nameFailure) nameInput.current?.focus()
    else if (emailFailure) emailInput.current?.focus()
    else props.onContinue()
  }
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <FieldGroup className="gap-4">
        <AuthField id="signup-name" label="Name" error={nameError}>
          {(control) => (
            <Input
              {...control}
              ref={nameInput}
              className="h-10 bg-card dark:bg-card"
              autoComplete="name"
              placeholder="Maya Chen"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
              autoFocus={!props.emailError}
              required
              value={props.name}
              onChange={(event) => {
                props.onNameChange(event.currentTarget.value)
                setNameError("")
              }}
            />
          )}
        </AuthField>
        <AuthField id="signup-email" label="Email" error={props.emailError}>
          {(control) => (
            <Input
              {...control}
              ref={emailInput}
              className="h-10 bg-card dark:bg-card"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
              autoFocus={props.emailError !== ""}
              required
              value={props.email}
              onChange={(event) => {
                props.onEmailChange(event.currentTarget.value)
                props.onEmailError("")
              }}
            />
          )}
        </AuthField>
        <Button type="submit" className="h-10 w-full">
          Continue
        </Button>
      </FieldGroup>
    </form>
  )
}

function PasswordStep(props: {
  email: string
  password: string
  onPasswordChange: (password: string) => void
  onChangeEmail: () => void
  error: string
  pending: boolean
  onSubmit: () => void
}) {
  const passwordInput = useRef<HTMLInputElement>(null)
  const [passwordError, setPasswordError] = useState("")
  const submit = () => {
    const failure = AuthForm.passwordError(props.password)
    setPasswordError(failure)
    if (failure) passwordInput.current?.focus()
    else props.onSubmit()
  }
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <FieldGroup className="gap-4">
        <FormError>{props.error}</FormError>
        <EmailSummary email={props.email} onChange={props.onChangeEmail} />
        <AuthField id="signup-password" label="Password" error={passwordError} hint={AuthForm.passwordHint}>
          {(control) => (
            <PasswordInput
              {...control}
              ref={passwordInput}
              autoComplete="new-password"
              placeholder="Create a password"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
              autoFocus
              required
              value={props.password}
              disabled={props.pending}
              onChange={(event) => {
                props.onPasswordChange(event.currentTarget.value)
                setPasswordError("")
              }}
            />
          )}
        </AuthField>
        <Button type="submit" className="h-10 w-full" disabled={props.pending}>
          {props.pending ? <Spinner data-icon="inline-start" /> : null}
          {props.pending ? "Creating account…" : "Create account"}
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
  const back = () => {
    setError("")
    setStep("details")
  }
  const createAccount = async () => {
    setError("")
    setPending(true)
    const result = await auth.signUp.email({ name: name.trim(), email, password })
    if (result.error !== null) {
      setPending(false)
      const failure = AuthError.describe(result.error)
      if (AuthForm.isEmailRejection(failure.code)) {
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
      <AuthLayout title="Create a password" description="" legal="signup">
        <PasswordStep
          email={email}
          password={password}
          onPasswordChange={setPassword}
          onChangeEmail={back}
          error={error}
          pending={pending}
          onSubmit={() => void createAccount()}
        />
      </AuthLayout>
    )
  return (
    <AuthLayout
      title={organizationName ? `Join ${organizationName}` : undefined}
      description={organizationName ? "Create your Ren account" : undefined}
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
      <div className="flex flex-col gap-2">
        <GoogleButton destination={destination} />
        <SocialButton provider="github" destination={destination} />
        <SocialButton provider="slack" destination={destination} />
      </div>
      <DetailsStep
        name={name}
        onNameChange={setName}
        email={email}
        onEmailChange={setEmail}
        emailError={emailError}
        onEmailError={setEmailError}
        onContinue={() => setStep("password")}
      />
    </AuthLayout>
  )
}
