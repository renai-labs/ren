import { AuthError } from "@ren/client"
import { useQueryClient } from "@tanstack/react-query"
import { openBrowserAsync } from "expo-web-browser"
import { useState } from "react"
import { Pressable, View } from "react-native"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { Button } from "#components/button"
import { Input } from "#components/input"
import { Text } from "#components/text"
import { Auth } from "#lib/auth"

type Step = "email" | "password" | "code"

type Attempt = () => Promise<{ readonly error: Parameters<typeof AuthError.describe>[0] | null }>

export default function SignIn() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  const attempt = async (call: Attempt, then: () => Promise<unknown> | void) => {
    setError("")
    setPending(true)
    const result = await call()
    setPending(false)
    if (result.error) setError(AuthError.describe(result.error).message)
    else await then()
  }
  const signedIn = () => queryClient.resetQueries()
  const sendCode = () => Auth.client.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
  const open = (path: string) => void openBrowserAsync(`${Auth.webUrl}/${path}`)
  const back = (to: Step) => {
    setError("")
    setStep(to)
  }
  const continueWithEmail = () => (email.includes("@") ? back("password") : setError("Enter a valid email address."))
  const signInWithPassword = () => void attempt(() => Auth.client.signIn.email({ email, password }), signedIn)
  const signInWithCode = () => void attempt(() => Auth.client.signIn.emailOtp({ email, otp: code }), signedIn)
  const invalid = error !== ""

  return (
    <KeyboardAwareScrollView
      className="flex-1 bg-background"
      contentContainerClassName="grow items-center justify-center p-6"
      keyboardShouldPersistTaps="handled"
    >
      <View className="w-full max-w-80 gap-8">
        <View>
          <Text className="text-xl font-medium tracking-tight">Welcome to Ren</Text>
          <Text className="text-xl tracking-tight text-muted-foreground">Self-improving software</Text>
        </View>
        <View className="gap-4">
          {step === "email" ? (
            <>
              <Input
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                aria-label="Email"
                invalid={invalid}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
                onSubmitEditing={continueWithEmail}
              />
              {invalid ? <Text className="text-sm text-destructive">{error}</Text> : null}
              <Button onPress={continueWithEmail}>
                <Text>Continue</Text>
              </Button>
              <Button variant="link" onPress={() => open("signup")}>
                <Text>Create an account</Text>
              </Button>
            </>
          ) : null}
          {step === "password" ? (
            <>
              <Pressable
                role="button"
                aria-label="Change email"
                className="h-11 flex-row items-center justify-between rounded-lg bg-muted px-3"
                onPress={() => back("email")}
              >
                <Text numberOfLines={1} className="flex-1">
                  {email}
                </Text>
                <Text className="text-sm text-muted-foreground">Change</Text>
              </Pressable>
              <Input
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                aria-label="Password"
                invalid={invalid}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={signInWithPassword}
              />
              {invalid ? <Text className="text-sm text-destructive">{error}</Text> : null}
              <Button disabled={pending} onPress={signInWithPassword}>
                <Text>Sign in</Text>
              </Button>
              <Button variant="secondary" disabled={pending} onPress={() => void attempt(sendCode, () => back("code"))}>
                <Text>Email me a sign-in code</Text>
              </Button>
              <Button variant="link" onPress={() => open(`forgot-password?email=${encodeURIComponent(email)}`)}>
                <Text>Forgot your password?</Text>
              </Button>
            </>
          ) : null}
          {step === "code" ? (
            <>
              <Text variant="muted">Enter the 6-digit code we sent to {email}.</Text>
              <Input
                value={code}
                onChangeText={setCode}
                placeholder="Code"
                aria-label="Sign-in code"
                invalid={invalid}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                onSubmitEditing={signInWithCode}
              />
              {invalid ? <Text className="text-sm text-destructive">{error}</Text> : null}
              <Button disabled={pending || code.length !== 6} onPress={signInWithCode}>
                <Text>Sign in</Text>
              </Button>
              <Button variant="ghost" disabled={pending} onPress={() => void attempt(sendCode, () => undefined)}>
                <Text>Send a new code</Text>
              </Button>
              <Button variant="link" onPress={() => back("password")}>
                <Text>Back</Text>
              </Button>
            </>
          ) : null}
        </View>
      </View>
    </KeyboardAwareScrollView>
  )
}
