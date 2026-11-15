import { AuthError } from "@ren/client"
import { useQueryClient } from "@tanstack/react-query"
import { openBrowserAsync } from "expo-web-browser"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import ChevronLeftIcon from "react-native-heroicons/mini/ChevronLeftIcon"
import EnvelopeIcon from "react-native-heroicons/mini/EnvelopeIcon"
import EyeIcon from "react-native-heroicons/mini/EyeIcon"
import EyeSlashIcon from "react-native-heroicons/mini/EyeSlashIcon"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Input } from "#components/input"
import { Text } from "#components/text"
import { Auth } from "#lib/auth"

type Step = "email" | "password" | "code"

const codeLength = 6

const resendDelay = 30_000

const open = (url: string) => void openBrowserAsync(new URL(url, `${Auth.webUrl}/`).href)

const sendCode = (email: string) => Auth.client.emailOtp.sendVerificationOtp({ email, type: "sign-in" })

function FormError(props: { readonly children: string }) {
  if (!props.children) return null
  return <Text className="text-sm text-destructive">{props.children}</Text>
}

function BackButton(props: { readonly onPress: () => void }) {
  return (
    <Button variant="ghost" className="self-center" onPress={props.onPress}>
      <Icon as={ChevronLeftIcon} className="size-4.5 text-muted-foreground" />
      <Text className="text-muted-foreground">Go back</Text>
    </Button>
  )
}

function PasswordInput(props: {
  readonly value: string
  readonly onChangeText: (value: string) => void
  readonly invalid: boolean
  readonly editable: boolean
  readonly onSubmitEditing: () => void
}) {
  const [shown, setShown] = useState(false)
  return (
    <View className="justify-center">
      <Input
        {...props}
        className="pr-11"
        placeholder="Your password"
        aria-label="Password"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
        autoFocus
        secureTextEntry={!shown}
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
      />
      <Pressable
        role="button"
        aria-label={shown ? "Hide password" : "Show password"}
        className="absolute right-0 size-11 items-center justify-center"
        onPress={() => setShown(!shown)}
      >
        <Icon as={shown ? EyeSlashIcon : EyeIcon} className="size-4.5 text-muted-foreground" />
      </Pressable>
    </View>
  )
}

function CodeStep(props: { readonly email: string; readonly onSignedIn: () => Promise<void> }) {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendAt, setResendAt] = useState(() => Date.now() + resendDelay)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (now >= resendAt) return
    const timer = setTimeout(() => setNow(Date.now()), 250)
    return () => clearTimeout(timer)
  }, [now, resendAt])
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000))

  const verify = async (value: string) => {
    setVerifying(true)
    setError("")
    const result = await Auth.client.signIn.emailOtp({ email: props.email, otp: value })
    if (!result.error) {
      await props.onSignedIn()
      return
    }
    const failure = AuthError.describe(result.error)
    setVerifying(false)
    setError(failure.message)
    if (failure.code === "TOO_MANY_ATTEMPTS" || failure.code === "OTP_EXPIRED") setCode("")
  }
  const resend = async () => {
    setResending(true)
    const result = await sendCode(props.email)
    setResending(false)
    if (result.error) {
      setError(AuthError.describe(result.error).message)
      return
    }
    setCode("")
    setError("")
    setResendAt(Date.now() + resendDelay)
    setNow(Date.now())
  }

  return (
    <View className="gap-2">
      <Text className="text-muted-foreground">
        Enter the code sent to <Text className="font-medium">{props.email}</Text>
      </Text>
      <Input
        value={code}
        onChangeText={(next) => {
          const digits = next.replaceAll(/\D/gu, "").slice(0, codeLength)
          setCode(digits)
          setError("")
          if (digits.length === codeLength && !verifying) void verify(digits)
        }}
        aria-label="Sign-in code"
        invalid={error !== ""}
        editable={!verifying}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this code
        autoFocus
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={codeLength}
        className="h-14 text-center font-mono text-2xl tracking-widest"
      />
      <FormError>{error}</FormError>
      <View className="h-9 flex-row items-center gap-1">
        {verifying ? (
          <ActivityIndicator size="small" />
        ) : (
          <Text className="text-sm text-muted-foreground">Didn’t receive a code?</Text>
        )}
        {!verifying && remaining > 0 ? (
          <Text className="text-sm text-muted-foreground tabular-nums">
            Resend in 0:{String(remaining).padStart(2, "0")}
          </Text>
        ) : null}
        {!verifying && remaining <= 0 ? (
          <Button variant="link" size="sm" className="px-0" disabled={resending} onPress={() => void resend()}>
            <Text className="text-sm">Resend code</Text>
          </Button>
        ) : null}
      </View>
    </View>
  )
}

export default function SignIn() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState<"password" | "code" | null>(null)

  const signedIn = () => Auth.refreshSession(queryClient)
  const back = () => {
    setError("")
    setStep("email")
  }
  const checkEmail = () => {
    const valid = email.includes("@")
    setError(valid ? "" : "Enter a valid email address.")
    return valid
  }
  const continueWithEmail = () => {
    if (checkEmail()) setStep("password")
  }
  const emailCode = async () => {
    if (!checkEmail()) return
    setPending("code")
    const result = await sendCode(email)
    setPending(null)
    if (!result.error) setStep("code")
    else setError(AuthError.describe(result.error).message)
  }
  const signIn = async () => {
    setError("")
    setPending("password")
    const result = await Auth.client.signIn.email({ email, password })
    if (!result.error) {
      await signedIn()
      return
    }
    setPending(null)
    const failure = AuthError.describe(result.error)
    setError(failure.message)
    if (failure.code === "EMAIL_NOT_VERIFIED") open(`verify-email?email=${encodeURIComponent(email)}`)
  }

  return (
    <KeyboardAwareScrollView
      className="flex-1 bg-background"
      contentContainerClassName="grow items-center px-6 py-safe-offset-6"
      keyboardShouldPersistTaps="handled"
    >
      <View className="w-full max-w-80 flex-1 justify-center gap-8 py-12">
        <View>
          <Text className="text-xl font-medium tracking-tight">Welcome to Ren</Text>
          <Text className="text-xl tracking-tight text-muted-foreground">Self-improving software</Text>
        </View>
        {step === "email" ? (
          <>
            <View className="gap-4">
              <FormError>{error}</FormError>
              <View className="gap-2">
                <Text className="text-sm font-medium">Email</Text>
                <Input
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@company.com"
                  aria-label="Email"
                  invalid={error !== ""}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  onSubmitEditing={continueWithEmail}
                />
              </View>
              <Button disabled={Boolean(pending)} onPress={continueWithEmail}>
                <Text>Continue with password</Text>
              </Button>
              <Button variant="secondary" disabled={Boolean(pending)} onPress={() => void emailCode()}>
                {pending === "code" ? (
                  <ActivityIndicator size="small" colorClassName="accent-secondary-foreground" />
                ) : (
                  <Icon as={EnvelopeIcon} className="size-4.5" />
                )}
                <Text>Email me a sign-in code</Text>
              </Button>
            </View>
            <Text className="text-center text-sm text-muted-foreground">
              Don’t have an account?{" "}
              <Text role="link" className="text-sm font-medium" onPress={() => open("signup")}>
                Sign up
              </Text>
            </Text>
          </>
        ) : null}
        {step === "password" ? (
          <View className="gap-4">
            <FormError>{error}</FormError>
            <Pressable
              role="button"
              aria-label="Change email"
              className="h-11 flex-row items-center justify-between rounded-lg bg-muted px-3"
              onPress={back}
            >
              <Text numberOfLines={1} className="flex-1">
                {email}
              </Text>
              <Text className="text-sm text-muted-foreground">Change</Text>
            </Pressable>
            <View className="gap-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium">Password</Text>
                <Text
                  role="link"
                  className="text-sm text-muted-foreground"
                  onPress={() => open(`forgot-password?email=${encodeURIComponent(email)}`)}
                >
                  Forgot your password?
                </Text>
              </View>
              <PasswordInput
                value={password}
                onChangeText={setPassword}
                invalid={error !== ""}
                editable={!pending}
                onSubmitEditing={() => void signIn()}
              />
            </View>
            <Button disabled={Boolean(pending)} onPress={() => void signIn()}>
              {pending === "password" ? (
                <ActivityIndicator size="small" colorClassName="accent-primary-foreground" />
              ) : null}
              <Text>{pending === "password" ? "Signing in…" : "Sign in"}</Text>
            </Button>
            <BackButton onPress={back} />
          </View>
        ) : null}
        {step === "code" ? (
          <View className="gap-4">
            <CodeStep email={email} onSignedIn={signedIn} />
            <BackButton onPress={back} />
          </View>
        ) : null}
      </View>
      <Text className="text-center text-xs text-muted-foreground">
        <Text role="link" className="text-xs text-muted-foreground" onPress={() => open("/terms/")}>
          Terms of Service
        </Text>{" "}
        and{" "}
        <Text role="link" className="text-xs text-muted-foreground" onPress={() => open("/privacy/")}>
          Privacy Policy
        </Text>
      </Text>
    </KeyboardAwareScrollView>
  )
}
