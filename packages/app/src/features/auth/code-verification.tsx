import { Button } from "@ren/ui/button"
import { CodeField } from "@ren/ui/code-field"
import { Text } from "@ren/ui/text"
import { useId, useState } from "react"
import { Countdown } from "../../lib/countdown.js"
import type { AuthError } from "./auth-error.js"

const codeLength = 6
const resendCooldownSeconds = 30

export function CodeVerification(props: {
  email: string
  verify: (code: string) => Promise<AuthError.Failure | undefined>
  resend: () => Promise<AuthError.Failure | undefined>
}) {
  const labelId = useId()
  const errorId = useId()
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const countdown = Countdown.useCountdown(resendCooldownSeconds)

  const submit = async (value: string) => {
    if (verifying || value.length !== codeLength) return
    setVerifying(true)
    setError("")
    const failure = await props.verify(value)
    if (failure === undefined) return
    setVerifying(false)
    setError(failure.message)
    if (failure.code === "TOO_MANY_ATTEMPTS" || failure.code === "OTP_EXPIRED") setCode("")
  }

  const resend = async () => {
    setResending(true)
    const failure = await props.resend()
    setResending(false)
    if (failure !== undefined) {
      setError(failure.message)
      return
    }
    setCode("")
    setError("")
    countdown.restart()
  }

  return (
    <div className="flex flex-col gap-4">
      <div id={labelId} className="flex flex-col">
        <Text tone="secondary">Enter the code sent to</Text>
        <Text purpose="label" element="p" wrapping="anywhere">
          {props.email}
        </Text>
      </div>
      <CodeField
        length={codeLength}
        value={code}
        onValueChange={(next) => {
          setCode(next)
          setError("")
        }}
        onValueComplete={(value) => void submit(value)}
        invalid={error !== ""}
        readOnly={verifying}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this code
        autoFocus
        slotLabel="Code digit"
        aria-labelledby={labelId}
        aria-describedby={error === "" ? undefined : errorId}
      />
      {error === "" ? null : (
        <Text tone="danger" id={errorId} aria-live="polite">
          {error}
        </Text>
      )}
      <div className="flex items-center gap-1">
        <Text tone="secondary" element="span">
          Didn’t receive a code?
        </Text>
        {countdown.remaining > 0 ? (
          <Text tone="secondary" element="span" numerals="tabular">
            Resend in 0:{String(countdown.remaining).padStart(2, "0")}
          </Text>
        ) : (
          <Button appearance="link" pending={resending} onClick={() => void resend()}>
            Resend code
          </Button>
        )}
      </div>
    </div>
  )
}
