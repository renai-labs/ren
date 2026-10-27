import { Link } from "@tanstack/react-router"
import { IconMail } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  AuthLayout,
  BackButton,
  CodeVerification,
  FormError,
  GoogleButton,
  PasswordInput,
  SocialButton,
} from "@/components/ren/auth"
import { useLoginPage } from "@/routes/auth/use-login-page"

export function LoginPage() {
  const page = useLoginPage()
  if (page.step === "code")
    return (
      <AuthLayout>
        <CodeVerification email={page.email} verify={page.verifyCode} resend={page.resendCode} />
        <BackButton onClick={page.back} />
      </AuthLayout>
    )
  if (page.step === "password")
    return (
      <AuthLayout>
        <FormError>{page.error}</FormError>
        <Button
          type="button"
          variant="secondary"
          className="h-10 w-full"
          disabled={page.pending !== null}
          onClick={() => void page.sendCode()}
        >
          {page.pending === "code" ? <Spinner data-icon="inline-start" /> : <IconMail data-icon="inline-start" />}
          Email sign-in code
        </Button>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void page.signIn()
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="login-email">Email</FieldLabel>
              <Input
                id="login-email"
                type="email"
                value={page.email}
                readOnly
                className="h-10 border-transparent bg-muted dark:bg-muted"
              />
            </Field>
            <Field>
              <div className="flex items-center">
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                <Link
                  to="/forgot-password"
                  search={{ email: page.email }}
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
                value={page.password}
                onChange={(event) => page.setPassword(event.currentTarget.value)}
                disabled={page.pending !== null}
              />
            </Field>
            <Button type="submit" className="h-10 w-full" disabled={page.pending !== null}>
              {page.pending === "password" ? <Spinner data-icon="inline-start" /> : null}
              {page.pending === "password" ? "Signing in…" : "Sign in"}
            </Button>
          </FieldGroup>
        </form>
        <BackButton onClick={page.back} />
      </AuthLayout>
    )
  return (
    <AuthLayout
      footer={
        <>
          Don’t have an account?{" "}
          <Link to="/signup" search={page.destination}>
            Sign up
          </Link>
        </>
      }
    >
      <GoogleButton destination={page.destination} />
      <SocialButton provider="github" destination={page.destination} />
      <SocialButton provider="slack" destination={page.destination} />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          page.continueWithEmail()
        }}
      >
        <FieldGroup className="gap-4">
          <FormError>{page.error}</FormError>
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
              value={page.email}
              onChange={(event) => page.setEmail(event.currentTarget.value)}
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
