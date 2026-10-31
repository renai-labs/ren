import { useEffect, useId, useState, type ComponentProps, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Channel } from "@ren/schema/channel"
import {
  IconAlertCircle,
  IconBrandGithub,
  IconBrandSlack,
  IconChevronLeft,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Link } from "@ren/ui/link"
import { Field, FieldDescription, FieldError, FieldLabel } from "@ren/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@ren/ui/input-group"
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@ren/ui/input-otp"
import { Spinner } from "@ren/ui/spinner"
import { destinationHref, type AuthFailure, type Destination } from "../lib/auth.js"
import { RouterContext } from "../lib/router-context.js"
import { Platform } from "../platform/platform.js"

export function AuthLayout(props: {
  title?: ReactNode | undefined
  description?: ReactNode | undefined
  children: ReactNode
  footer?: ReactNode | undefined
  legal?: "browse" | "signup" | false | undefined
}) {
  return (
    <main className="relative flex min-h-svh flex-col bg-background p-6">
      <div className="flex w-full flex-1 flex-col items-center justify-center py-12">
        <div className="flex w-full max-w-80 flex-col gap-8">
          <div className="flex flex-col">
            <h1 className="text-xl/7 font-medium tracking-tight">{props.title ?? "Welcome to Ren"}</h1>
            {props.description === null || props.description === "" ? null : (
              <p className="text-xl/7 tracking-tight text-muted-foreground">
                {props.description ?? "Self-improving software"}
              </p>
            )}
          </div>
          {props.children}
          {props.footer ? (
            <FieldDescription className="text-center leading-5 [&>a]:font-medium [&>a]:text-foreground [&>a]:no-underline [&>a:hover]:underline">
              {props.footer}
            </FieldDescription>
          ) : null}
        </div>
      </div>
      {props.legal === false ? null : (
        <footer className="flex shrink-0 justify-center text-center">
          <LegalFooter purpose={props.legal ?? "browse"} />
        </footer>
      )}
    </main>
  )
}

function LegalFooter(props: { purpose?: "browse" | "signup" | undefined }) {
  return (
    <FieldDescription className="text-center text-xs [&>a]:no-underline [&>a:hover]:text-foreground">
      {props.purpose === "signup" ? "By creating an account, you agree to the " : null}
      <Link href="/terms/" external appearance="plain">
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link href="/privacy/" external appearance="plain">
        Privacy Policy
      </Link>
    </FieldDescription>
  )
}

export function PasswordInput(props: Omit<ComponentProps<typeof InputGroupInput>, "type">) {
  const [shown, setShown] = useState(false)
  return (
    <InputGroup className="h-10 bg-card dark:bg-card">
      <InputGroupInput {...props} type={shown ? "text" : "password"} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
        >
          {shown ? <IconEyeOff /> : <IconEye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function FormError(props: { children: ReactNode }) {
  if (!props.children) return null
  return (
    <Alert variant="destructive">
      <IconAlertCircle />
      <AlertDescription>{props.children}</AlertDescription>
    </Alert>
  )
}

export function BackButton(props: { onClick: () => void; children?: ReactNode | undefined }) {
  return (
    <Button type="button" variant="ghost" className="self-center text-muted-foreground" onClick={props.onClick}>
      <IconChevronLeft data-icon="inline-start" />
      {props.children ?? "Go back"}
    </Button>
  )
}

const googleMark = [
  {
    fill: "#4285f4",
    d: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z",
  },
  {
    fill: "#34a853",
    d: "M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z",
  },
  {
    fill: "#fbbc05",
    d: "M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z",
  },
  {
    fill: "#ea4335",
    d: "M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z",
  },
]

export function GoogleButton(props: { destination: Destination }) {
  const { auth } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const afterAuth = `${platform.appUrl}${destinationHref({ ...props.destination, join: true })}`
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-10 w-full"
      onClick={() =>
        void auth.signIn.social({ provider: "google", callbackURL: afterAuth, newUserCallbackURL: afterAuth })
      }
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" data-icon="inline-start" className="size-4">
        {googleMark.map((path) => (
          <path key={path.fill} fill={path.fill} d={path.d} />
        ))}
      </svg>
      Continue with Google
    </Button>
  )
}

const socialIcons = { github: IconBrandGithub, slack: IconBrandSlack } as const

export function SocialButton(props: { provider: "github" | "slack"; destination: Destination }) {
  const { api, auth } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const offered = useQuery({
    ...api["sign-in"]["sign-in-provider"].list.queryOptions(),
    select: (providers) => providers.items.includes(props.provider),
  })
  if (!offered.data) return null
  const destination =
    props.provider === "slack"
      ? { ...props.destination, redirect: props.destination.redirect ?? "/settings/channels/slack?connect=true" }
      : props.destination
  const afterAuth = `${platform.appUrl}${destinationHref({ ...destination, join: true })}`
  const Icon = socialIcons[props.provider]
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-10 w-full"
      onClick={() =>
        void auth.signIn.social({ provider: props.provider, callbackURL: afterAuth, newUserCallbackURL: afterAuth })
      }
    >
      <Icon data-icon="inline-start" />
      Continue with {Channel.titles[props.provider]}
    </Button>
  )
}

function useCountdown(seconds: number) {
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (now >= endsAt) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [now, endsAt])
  return {
    remaining: Math.max(0, Math.ceil((endsAt - now) / 1000)),
    restart: () => {
      setEndsAt(Date.now() + seconds * 1000)
      setNow(Date.now())
    },
  }
}

const codeLength = 6

export function CodeVerification(props: {
  email: string
  verify: (code: string) => Promise<AuthFailure | undefined>
  resend: () => Promise<AuthFailure | undefined>
}) {
  const id = useId()
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const countdown = useCountdown(30)
  const submit = async (value: string) => {
    if (verifying || value.length !== codeLength) return
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
    countdown.restart()
  }
  return (
    <Field data-invalid={error !== "" || undefined}>
      <FieldLabel htmlFor={id} className="flex-col items-start gap-0 font-normal">
        <span className="text-muted-foreground">Enter the code sent to</span>
        <span className="font-medium break-all">{props.email}</span>
      </FieldLabel>
      <InputOTP
        id={id}
        maxLength={codeLength}
        value={code}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this code
        autoFocus
        readOnly={verifying}
        aria-invalid={error !== "" || undefined}
        onChange={(next) => {
          setCode(next)
          setError("")
        }}
        onComplete={(value: string) => void submit(value)}
      >
        <InputOTPGroup className="*:data-[slot=input-otp-slot]:h-12 *:data-[slot=input-otp-slot]:w-11 *:data-[slot=input-otp-slot]:text-xl">
          {[0, 1, 2].map((index) => (
            <InputOTPSlot key={index} index={index} aria-label={`Code digit ${index + 1}`} />
          ))}
        </InputOTPGroup>
        <InputOTPSeparator className="mx-2" />
        <InputOTPGroup className="*:data-[slot=input-otp-slot]:h-12 *:data-[slot=input-otp-slot]:w-11 *:data-[slot=input-otp-slot]:text-xl">
          {[3, 4, 5].map((index) => (
            <InputOTPSlot key={index} index={index} aria-label={`Code digit ${index + 1}`} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {error ? <FieldError>{error}</FieldError> : null}
      <FieldDescription className="flex items-center gap-1">
        {verifying ? <Spinner /> : "Didn’t receive a code?"}
        {!verifying && countdown.remaining > 0 ? (
          <span className="tabular-nums">Resend in 0:{String(countdown.remaining).padStart(2, "0")}</span>
        ) : null}
        {!verifying && countdown.remaining <= 0 ? (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            disabled={resending}
            onClick={() => void resend()}
          >
            Resend code
          </Button>
        ) : null}
      </FieldDescription>
    </Field>
  )
}
