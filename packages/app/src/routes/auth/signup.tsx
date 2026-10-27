import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { AuthLayout, BackButton, FormError, GoogleButton, PasswordInput, SocialButton } from "@/components/ren/auth"
import { useSignupPage } from "@/routes/auth/use-signup-page"

export function SignupPage() {
  const page = useSignupPage()
  if (page.step === "password")
    return (
      <AuthLayout title={page.title} description={page.description} legal="signup">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void page.createAccount()
          }}
        >
          <FieldGroup className="gap-4">
            <FormError>{page.error}</FormError>
            <Field>
              <FieldLabel htmlFor="signup-email">Email</FieldLabel>
              <Input
                id="signup-email"
                type="email"
                value={page.email}
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
                value={page.password}
                disabled={page.pending}
                onChange={(event) => page.setPassword(event.currentTarget.value)}
              />
              <FieldDescription>At least 8 characters</FieldDescription>
            </Field>
            <Button type="submit" className="h-10 w-full" disabled={page.pending}>
              {page.pending ? <Spinner data-icon="inline-start" /> : null}
              {page.pending ? "Creating account…" : "Continue"}
            </Button>
          </FieldGroup>
        </form>
        <BackButton onClick={page.back} />
      </AuthLayout>
    )
  return (
    <AuthLayout
      title={page.title}
      description={page.description}
      legal="signup"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" search={page.destination}>
            Sign in
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
          page.continueWithDetails()
        }}
      >
        <FieldGroup className="gap-4">
          <FormError>{page.error}</FormError>
          <Field>
            <FieldLabel htmlFor="signup-name">Name</FieldLabel>
            <Input
              className="h-10 bg-card dark:bg-card"
              id="signup-name"
              autoComplete="name"
              placeholder="Maya Chen"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
              autoFocus={!page.emailError}
              required
              value={page.name}
              onChange={(event) => page.setName(event.currentTarget.value)}
            />
          </Field>
          <Field data-invalid={page.emailError !== "" || undefined}>
            <FieldLabel htmlFor="signup-email">Email</FieldLabel>
            <Input
              className="h-10 bg-card dark:bg-card"
              id="signup-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
              autoFocus={page.emailError !== ""}
              required
              aria-invalid={page.emailError !== "" || undefined}
              value={page.email}
              onChange={(event) => page.setEmail(event.currentTarget.value)}
            />
            {page.emailError ? <FieldError>{page.emailError}</FieldError> : null}
          </Field>
          <Button type="submit" className="h-10 w-full">
            Continue
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  )
}
