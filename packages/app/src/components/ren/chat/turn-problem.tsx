import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { IconAlertCircle, IconArrowUpRight, IconChevronRight } from "@tabler/icons-react"
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
  const model = input.model
  const elsewhere = `pick a model from ${provider === "the model provider" ? "another provider" : `a provider other than ${provider}`}`
  if (/budget/iu.test(text) && /exceed/iu.test(text)) {
    if (input.midTurn)
      return {
        title: "Ren ran out of credits partway through.",
        fix: input.admin
          ? "Add credits, then hit Continue to pick up where Ren left off."
          : "Ask an admin to add credits, then hit Continue to pick up where Ren left off.",
        actions: input.admin ? ["continue", "providers"] : ["continue"],
      }
    return {
      title: "You’re out of Ren credits.",
      fix: input.admin
        ? "Add credits, or connect your own Claude or ChatGPT account in Providers. Then try again."
        : "Ask an admin to add credits, then try again.",
      actions: input.admin ? ["try", "providers"] : ["try"],
    }
  }
  if (/usage limit|weekly limit|plan limit/iu.test(text)) {
    const reset = resetPhrase(text)
    return {
      title: `You’ve hit your ${provider} usage limit.`,
      fix: `${reset ? `It resets ${reset}.` : "It resets soon."} To keep going now, ${elsewhere}.`,
      actions: ["model", "try"],
    }
  }
  if (
    /not supported when using .* account|not included in your plan|your plan does not|not available on your plan/iu.test(
      text,
    )
  )
    return {
      title: `${model} isn’t included in your ${provider} plan.`,
      fix: "Pick another model to keep going, or upgrade your plan.",
      actions: ["model"],
    }
  if (/do not have access to it|does not have access to (the )?model/iu.test(text))
    return {
      title: `Your ${provider} account doesn’t have access to ${model}.`,
      fix: "Pick another model to keep going.",
      actions: ["model"],
    }
  if (/model_not_found|does not exist|no such model|model not found/iu.test(text))
    return {
      title: `${model} isn’t available right now.`,
      fix: "Pick another model to keep going.",
      actions: ["model"],
    }
  if (/context length|context window|too long|maximum context/iu.test(text))
    return {
      title: `This chat is too long for ${model}.`,
      fix: "Start a new chat, or pick a model that can handle more.",
      actions: ["new", "model"],
    }
  if (/temporarily unavailable|not available now/iu.test(text))
    return {
      title: `Your ${provider} account is temporarily unavailable.`,
      fix: "Give it a few minutes, then try again.",
      actions: ["try"],
    }
  if (/subscription/iu.test(text) && /inactive|expired|cancel|not active|payment/iu.test(text))
    return {
      title: `Your ${provider} subscription isn’t active.`,
      fix: `Renew it, or ${elsewhere}.`,
      actions: ["model", "try"],
    }
  switch (input.kind) {
    case "provider.free-limit":
      return {
        title: `${model} isn’t included in your plan.`,
        fix: "Pick another model to keep going.",
        actions: ["model"],
      }
    case "provider.quota":
      return {
        title: `${provider} models are down on our side.`,
        fix: `We’re on it. In the meantime, ${elsewhere}.`,
        actions: ["model"],
      }
    case "provider.rate-limit":
      return {
        title: `${provider} is getting too many requests.`,
        fix: `Wait a minute and try again, or ${elsewhere}.`,
        actions: ["try", "model"],
      }
    case "provider.auth":
      return input.admin
        ? {
            title: `Ren lost access to your ${provider} account.`,
            fix: "Reconnect it in Providers, then try again.",
            actions: ["providers", "try"],
          }
        : {
            title: `Ren lost access to the ${provider} account.`,
            fix: "Ask an admin to reconnect it, or pick another model.",
            actions: ["model"],
          }
    case "provider.no-route":
      return {
        title: `${model} isn’t available right now.`,
        fix: "Pick another model to keep going.",
        actions: ["model"],
      }
    case "provider.content-filter":
      return { title: `${provider} blocked this message.`, fix: "Try rewording it.", actions: ["try"] }
    case "provider.timeout":
    case "provider.transport":
    case "provider.internal":
      return {
        title: `${provider} didn’t respond.`,
        fix: `Try again, or ${elsewhere}.`,
        actions: ["try", "model"],
      }
    default:
      return { title: "Ren couldn’t finish that reply.", fix: "Try again.", actions: ["try"] }
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
  const variant = props.primary ? "default" : "ghost"
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
        <IconArrowUpRight data-icon="inline-end" />
      </Button>
    )
  if (props.action === "new")
    return (
      <Button variant={variant} size="sm" className={className} nativeButton={false} render={<Link to="/" />}>
        {labels.new}
        <IconArrowUpRight data-icon="inline-end" />
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
          <div className="flex flex-wrap items-center gap-1 pt-3">
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
      title={busy ? `${props.provider} is busy right now.` : `${props.provider} isn’t responding.`}
      fix={
        <span className="tabular-nums">
          {seconds > 0 ? `Trying again in ${seconds}s…` : "Trying again now…"}
          {props.attempt > 1 ? ` (attempt ${props.attempt})` : null}
        </span>
      }
      actions={["stop"]}
      handlers={props.handlers}
      details={props.text.trim() || undefined}
    />
  )
}
