import { AuthError, AuthForm } from "@ren/client"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import EnvelopeIcon from "react-native-heroicons/mini/EnvelopeIcon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Input } from "#components/input"
import { Text } from "#components/text"
import { AuthLayout, BackButton, Field, FooterLink, FormError } from "#features/auth/auth-layout"
import { CodeVerification } from "#features/auth/code-verification"
import { PasswordInput } from "#features/auth/password-input"
import { SocialButtons } from "#features/auth/social-buttons"
import { Auth } from "#lib/auth"

type Step = "email" | "password" | "code"

const sendCode = (email: string) => Auth.client.emailOtp.sendVerificationOtp({ email, type: "sign-in" })

export default function SignIn() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState<"password" | "code" | null>(null)
  const address = email.trim()

  const signedIn = () => Auth.refreshSession(queryClient)
  const back = () => {
    setError("")
    setStep("email")
  }
  const checkEmail = () => {
    const failure = AuthForm.emailError(address)
    setError(failure)
    return failure === ""
  }
  const continueWithEmail = () => {
    if (checkEmail()) setStep("password")
  }
  const emailCode = async () => {
    if (!checkEmail()) return
    setPending("code")
    const result = await sendCode(address)
    setPending(null)
    if (!result.error) setStep("code")
    else setError(AuthError.describe(result.error).message)
  }
  const signIn = async () => {
    setError("")
    setPending("password")
    const result = await Auth.client.signIn.email({ email: address, password })
    if (!result.error) {
      await signedIn()
      return
    }
    setPending(null)
    const failure = AuthError.describe(result.error)
    if (failure.code === "EMAIL_NOT_VERIFIED") {
      router.push({ pathname: "/verify-email", params: { email: address } })
      return
    }
    setError(failure.message)
  }
  const verifyCode = async (otp: string) => {
    const result = await Auth.client.signIn.emailOtp({ email: address, otp })
    if (result.error) return AuthError.describe(result.error)
    await signedIn()
    return
  }
  const resendCode = async () => {
    const result = await sendCode(address)
    return result.error ? AuthError.describe(result.error) : undefined
  }

  if (step === "code")
    return (
      <AuthLayout>
        <CodeVerification email={address} verify={verifyCode} resend={resendCode} />
        <BackButton onPress={back} />
      </AuthLayout>
    )
  if (step === "password")
    return (
      <AuthLayout>
        <FormError>{error}</FormError>
        <View className="gap-4">
          <Field label="Email">
            <Input value={address} readOnly aria-label="Email" className="border-transparent bg-muted" />
          </Field>
          <Field
            label="Password"
            accessory={
              <Text
                role="link"
                className="text-sm text-muted-foreground"
                onPress={() => Auth.openWeb(`forgot-password?email=${encodeURIComponent(address)}`)}
              >
                Forgot your password?
              </Text>
            }
          >
            <PasswordInput
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              invalid={error !== ""}
              editable={pending === null}
              onSubmitEditing={() => void signIn()}
            />
          </Field>
          <Button disabled={pending !== null} onPress={() => void signIn()}>
            {pending === "password" ? (
              <ActivityIndicator size="small" colorClassName="accent-primary-foreground" />
            ) : null}
            <Text>{pending === "password" ? "Signing in…" : "Sign in"}</Text>
          </Button>
        </View>
        <BackButton onPress={back} />
      </AuthLayout>
    )
  return (
    <AuthLayout
      footer={
        <>
          Don’t have an account? <FooterLink onPress={() => router.replace("/sign-up")}>Sign up</FooterLink>
        </>
      }
    >
      <SocialButtons onError={setError} />
      <View className="gap-4">
        <FormError>{error}</FormError>
        <Field label="Email">
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="you@company.com"
            aria-label="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={continueWithEmail}
          />
        </Field>
        <Button disabled={pending !== null} onPress={continueWithEmail}>
          <Text>Continue</Text>
        </Button>
        <Button variant="secondary" disabled={pending !== null} onPress={() => void emailCode()}>
          {pending === "code" ? (
            <ActivityIndicator size="small" colorClassName="accent-secondary-foreground" />
          ) : (
            <Icon as={EnvelopeIcon} className="size-4.5" />
          )}
          <Text>Email me a sign-in code</Text>
        </Button>
      </View>
    </AuthLayout>
  )
}
