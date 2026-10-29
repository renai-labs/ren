import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { IconAlertCircle, IconChevronRight } from "@tabler/icons-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export type ProblemAction = "try" | "continue" | "model" | "providers" | "new" | "stop"

export interface ProblemHandlers {
  readonly onTryAgain?: (() => void) | undefined
  readonly onContinue?: (() => void) | undefined
  readonly onChangeModel?: (() => void) | undefined
  readonly onStop?: (() => void) | undefined
}

interface Problem {
  readonly title: string
  readonly fix: string
  readonly actions: ReadonlyArray<ProblemAction>
}

const providerLabels: Readonly<Record<string, string>> = { anthropic: "Anthropic", openai: "OpenAI" }

export const providerLabel = (id: string) => providerLabels[id] ?? id.charAt(0).toUpperCase() + id.slice(1)

const resetPhrase = (text: string) => /\b(?:resets?|try again)\s+((?:in|at|on)\s+[^.,;]+)/iu.exec(text)?.[1]?.trim()

export function problemOf(input: {
  readonly kind: string
  readonly text: string
  readonly provider: string
  readonly model: string
  readonly midTurn: boolean
  readonly admin: boolean
}): Problem {
  const text = input.text
  const provider = input.provider
  const resume: ProblemAction = input.midTurn ? "continue" : "try"
  const then = input.midTurn ? "Then select Continue." : "Then try again."
  if (/budget/iu.test(text) && /exceed/iu.test(text))
    return {
      title: input.midTurn
        ? "Ren stopped. Your organization has no Ren credits."
        : "Your organization has no Ren credits.",
      fix: input.admin
        ? `Add Ren credits, or connect a Claude or ChatGPT account in Providers. ${then}`
        : `Tell an admin to add Ren credits. ${then}`,
      actions: input.admin ? [resume, "providers"] : [resume],
    }
  if (/context length|context window|too long|maximum context/iu.test(text))
    return {
      title: "This chat is too long for the model.",
      fix: "Start a new chat, or select a model with a larger context.",
      actions: ["new", "model"],
    }
  if (/temporarily unavailable|not available now/iu.test(text))
    return {
      title: `Your ${provider} account is not available now.`,
      fix: "Wait some minutes. Then try again.",
      actions: ["try"],
    }
  if (/subscription/iu.test(text) && /inactive|expired|cancel|not active|payment/iu.test(text))
    return {
      title: `Your ${provider} subscription is not active.`,
      fix: "Renew your subscription, or select a model from a different provider.",
      actions: ["model", "try"],
    }
  switch (input.kind) {
    case "provider.free-limit":
      return { title: `${input.model} is not on your plan.`, fix: "Select a different model.", actions: ["model"] }
    case "provider.quota":
      return {
        title: `${provider} models are not available now.`,
        fix: "This is a problem on Ren’s side. Select a model from a different provider.",
        actions: ["model"],
      }
    case "provider.rate-limit": {
      if (/usage limit|weekly|limit reached for your|plan limit/iu.test(text)) {
        const reset = resetPhrase(text)
        return {
          title: `Your ${provider} account reached its usage limit.`,
          fix: `${reset ? `The limit resets ${reset}.` : "The limit resets later."} Select a model from a different provider to continue now.`,
          actions: ["model", "try"],
        }
      }
      return {
        title: `${provider} has too many requests now.`,
        fix: "Wait one minute. Then try again, or select a model from a different provider.",
        actions: ["try", "model"],
      }
    }
    case "provider.auth":
      return input.admin
        ? {
            title: `Ren cannot use the ${provider} account.`,
            fix: "Connect the account again in Providers. Then try again.",
            actions: ["providers", "try"],
          }
        : {
            title: `Ren cannot use the ${provider} account.`,
            fix: "Tell an admin to connect the account again, or select a different model.",
            actions: ["model"],
          }
    case "provider.no-route":
      return { title: `${input.model} is not available.`, fix: "Select a different model.", actions: ["model"] }
    case "provider.content-filter":
      return {
        title: `${provider} blocked this message.`,
        fix: "Change your message. Then try again.",
        actions: ["try"],
      }
    case "provider.timeout":
    case "provider.transport":
    case "provider.internal":
      return {
        title: `${provider} did not answer.`,
        fix: "Try again, or select a model from a different provider.",
        actions: ["try", "model"],
      }
    default:
      return { title: "Ren stopped because of an error.", fix: "Try again.", actions: ["try"] }
  }
}

const labels: Record<ProblemAction, string> = {
  try: "Try again",
  continue: "Continue",
  model: "Change model",
  providers: "Providers",
  new: "New chat",
  stop: "Stop",
}

function ActionButton(props: { action: ProblemAction; primary: boolean; handlers: ProblemHandlers }) {
  const variant = props.primary ? "secondary" : "ghost"
  const className = props.primary ? undefined : "text-muted-foreground"
  if (props.action === "providers")
    return (
      <Button
        variant={variant}
        size="sm"
        className={className}
        nativeButton={false}
        render={<Link to="/settings/providers" />}
      >
        {labels.providers}
      </Button>
    )
  if (props.action === "new")
    return (
      <Button variant={variant} size="sm" className={className} nativeButton={false} render={<Link to="/" />}>
        {labels.new}
      </Button>
    )
  const handler = {
    try: props.handlers.onTryAgain,
    continue: props.handlers.onContinue,
    model: props.handlers.onChangeModel,
    stop: props.handlers.onStop,
  }[props.action]
  if (!handler) return null
  return (
    <Button variant={variant} size="sm" className={className} onClick={handler}>
      {labels[props.action]}
    </Button>
  )
}

function Shell(props: {
  icon: React.ReactNode
  waiting?: boolean | undefined
  title: string
  fix: React.ReactNode
  actions: ReadonlyArray<ProblemAction>
  handlers: ProblemHandlers
  details?: string | undefined
}) {
  return (
    <Alert
      className={cn(
        "animate-in gap-x-3 rounded-none border-0 bg-transparent px-0 py-1 duration-200 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none",
        props.waiting ? "*:[svg]:text-muted-foreground" : "*:[svg]:text-destructive",
      )}
    >
      {props.icon}
      <AlertTitle>{props.title}</AlertTitle>
      <AlertDescription>{props.fix}</AlertDescription>
      {props.actions.length > 0 || props.details ? (
        <Collapsible className="col-start-2 flex flex-col">
          <div className="-ml-2.5 flex flex-wrap items-center gap-1 pt-2">
            {props.actions.map((action, index) => (
              <ActionButton key={action} action={action} primary={index === 0} handlers={props.handlers} />
            ))}
            {props.details ? (
              <CollapsibleTrigger
                render={<Button variant="ghost" size="sm" className="group/details text-muted-foreground" />}
              >
                Details
                <IconChevronRight
                  data-icon="inline-end"
                  className="transition-transform duration-150 ease-out group-aria-expanded/details:rotate-90"
                />
              </CollapsibleTrigger>
            ) : null}
          </div>
          {props.details ? (
            <CollapsibleContent className="pt-1 font-mono text-xs/5 wrap-break-word whitespace-pre-wrap text-muted-foreground">
              {props.details}
            </CollapsibleContent>
          ) : null}
        </Collapsible>
      ) : null}
    </Alert>
  )
}

export function TurnProblem(props: {
  kind: string
  text: string
  provider: string
  model: string
  midTurn: boolean
  admin: boolean
  handlers: ProblemHandlers
}) {
  const problem = problemOf(props)
  return (
    <Shell
      icon={<IconAlertCircle />}
      title={problem.title}
      fix={problem.fix}
      actions={problem.actions}
      handlers={props.handlers}
      details={props.text.trim() || undefined}
    />
  )
}

function useSecondsUntil(at: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.ceil((at - now) / 1000))
}

export function TurnRetrying(props: {
  kind: string
  text: string
  provider: string
  at: number
  attempt: number
  handlers: ProblemHandlers
}) {
  const seconds = useSecondsUntil(props.at)
  const busy = props.kind === "provider.rate-limit" && !/usage limit|weekly/iu.test(props.text)
  return (
    <Shell
      icon={<Spinner />}
      waiting
      title={busy ? `${props.provider} has too many requests now.` : `${props.provider} is not answering.`}
      fix={
        <span className="tabular-nums">
          {seconds > 0
            ? `Ren tries again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`
            : "Ren is trying again now."}
          {props.attempt > 1 ? ` This is attempt ${props.attempt}.` : null}
        </span>
      }
      actions={["stop"]}
      handlers={props.handlers}
      details={props.text.trim() || undefined}
    />
  )
}
