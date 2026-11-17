import { AuthForm, type AuthError } from "@ren/client"
import { cn } from "cn"
import { useEffect, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import MinusIcon from "react-native-heroicons/mini/MinusIcon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { TextField } from "#components/input"
import { Text } from "#components/text"

const resendDelay = AuthForm.resendSeconds * 1000

function Slots(props: {
  readonly code: string
  readonly indexes: ReadonlyArray<number>
  readonly active: number
  readonly invalid: boolean
}) {
  return (
    <View className="flex-row items-center rounded-lg">
      {props.indexes.map((index, position) => (
        <View
          key={index}
          className={cn(
            "h-12 w-11 items-center justify-center border-y border-r border-input dark:bg-input/30",
            position === 0 && "rounded-l-lg border-l",
            position === props.indexes.length - 1 && "rounded-r-lg",
            props.active === index && "border-ring",
            props.invalid && "border-destructive",
          )}
        >
          <Text className="text-xl">{props.code.charAt(index)}</Text>
        </View>
      ))}
    </View>
  )
}

export function CodeVerification(props: {
  readonly email: string
  readonly verify: (code: string) => Promise<AuthError.Failure | undefined>
  readonly resend: () => Promise<AuthError.Failure | undefined>
}) {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [focused, setFocused] = useState(false)
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
  const active = focused ? Math.min(code.length, AuthForm.codeLength - 1) : -1
  const half = AuthForm.codeLength / 2

  const submit = async (value: string) => {
    if (verifying || value.length !== AuthForm.codeLength) return
    setVerifying(true)
    setError("")
    const failure = await props.verify(value)
    if (!failure) return
    setVerifying(false)
    setError(failure.message)
    if (failure.code === "TOO_MANY_ATTEMPTS" || failure.code === "OTP_EXPIRED") setCode("")
  }
  const resend = async () => {
    setResending(true)
    const failure = await props.resend()
    setResending(false)
    if (failure) {
      setError(failure.message)
      return
    }
    setCode("")
    setError("")
    setResendAt(Date.now() + resendDelay)
    setNow(Date.now())
  }
  const indexes = Array.from({ length: AuthForm.codeLength }, (_, index) => index)

  return (
    <View className="gap-2">
      <View>
        <Text className="text-muted-foreground">Enter the code sent to</Text>
        <Text className="font-medium">{props.email}</Text>
      </View>
      <View className="flex-row items-center">
        <Slots code={code} indexes={indexes.slice(0, half)} active={active} invalid={error !== ""} />
        <View role="separator" className="mx-2">
          <Icon as={MinusIcon} className="size-4" />
        </View>
        <Slots code={code} indexes={indexes.slice(half)} active={active} invalid={error !== ""} />
        <TextField
          value={code}
          onChangeText={(next) => {
            const digits = next.replaceAll(/\D/gu, "").slice(0, AuthForm.codeLength)
            setCode(digits)
            setError("")
            void submit(digits)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Code"
          editable={!verifying}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this code
          autoFocus
          caretHidden
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={AuthForm.codeLength}
          className="absolute inset-0 opacity-0"
        />
      </View>
      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
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
