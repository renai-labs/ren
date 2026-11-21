import { AuthError, AuthForm } from "@ren/client"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { Button } from "#components/button"
import { Input } from "#components/input"
import { Text } from "#components/text"
import { AuthLayout, BackButton, Field, FooterLink, FormError } from "#features/auth/auth-layout"
import { NewPasswordInput } from "#features/auth/password-input"
import { SocialButtons } from "#features/auth/social-buttons"
import { Auth } from "#lib/auth"

export default function SignUp() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [step, setStep] = useState<"details" | "password">("details")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [emailError, setEmailError] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const address = email.trim()

  const back = () => {
    setError("")
    setStep("details")
  }
  const continueWithDetails = () => {
    const nameFailure = AuthForm.nameError(name)
    if (nameFailure) {
      setError(nameFailure)
      return
    }
    const emailFailure = AuthForm.emailError(address)
    if (emailFailure) {
      setEmailError(emailFailure)
      return
    }
    setError("")
    setStep("password")
  }
  const createAccount = async () => {
    const passwordFailure = AuthForm.passwordError(password)
    if (passwordFailure) {
      setError(passwordFailure)
      return
    }
    setError("")
    setPending(true)
    const result = await Auth.client.signUp.email({ name: name.trim(), email: address, password })
    if (result.error) {
      setPending(false)
      const failure = AuthError.describe(result.error)
      if (AuthForm.isEmailRejection(failure.code)) {
        setEmailError(failure.message)
        setStep("details")
      } else setError(failure.message)
      return
    }
    if (!result.data.token) {
      setPending(false)
      router.push({ pathname: "/verify-email", params: { email: address } })
      return
    }
    await Auth.refreshSession(queryClient)
  }

  if (step === "password")
    return (
      <AuthLayout legal="signup">
        <View className="gap-4">
          <FormError>{error}</FormError>
          <Field label="Email">
            <Input value={address} readOnly aria-label="Email" className="border-transparent bg-muted" />
          </Field>
          <Field label="Password" hint={AuthForm.passwordHint}>
            <NewPasswordInput
              value={password}
              onChangeText={setPassword}
              placeholder="Create a password"
              invalid={error !== ""}
              editable={!pending}
              onSubmitEditing={() => void createAccount()}
            />
          </Field>
          <Button disabled={pending} onPress={() => void createAccount()}>
            {pending ? <ActivityIndicator size="small" colorClassName="accent-primary-foreground" /> : null}
            <Text>{pending ? "Creating account…" : "Continue"}</Text>
          </Button>
        </View>
        <BackButton onPress={back} />
      </AuthLayout>
    )
  return (
    <AuthLayout
      legal="signup"
      footer={
        <>
          Already have an account? <FooterLink onPress={() => router.replace("/sign-in")}>Sign in</FooterLink>
        </>
      }
    >
      <SocialButtons onError={setError} />
      <View className="gap-4">
        <FormError>{error}</FormError>
        <Field label="Name">
          <Input
            value={name}
            onChangeText={setName}
            placeholder="Maya Chen"
            aria-label="Name"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
          />
        </Field>
        <Field label="Email" error={emailError}>
          <Input
            value={email}
            onChangeText={(value) => {
              setEmail(value)
              setEmailError("")
            }}
            placeholder="you@company.com"
            aria-label="Email"
            invalid={emailError !== ""}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={continueWithDetails}
          />
        </Field>
        <Button onPress={continueWithDetails}>
          <Text>Continue</Text>
        </Button>
      </View>
    </AuthLayout>
  )
}
