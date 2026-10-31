import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Spinner } from "@ren/ui/spinner"
import { IconAlertCircle, IconArrowUpRight, IconChevronRight } from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Countdown } from "../../lib/countdown.js"

type Action = "try" | "continue" | "model" | "providers" | "new" | "stop"

export interface Handlers {
  readonly onTryAgain?: (() => void) | undefined
  readonly onContinue?: (() => void) | undefined
  readonly onChangeModel?: (() => void) | undefined
  readonly onStop?: (() => void) | undefined
}

interface Problem {
  readonly title: string
  readonly fix: string
  readonly actions: ReadonlyArray<Action>
}

const providerLabels: Readonly<Record<string, string>> = { anthropic: "Anthropic", openai: "OpenAI" }

const providerLabel = (id: string) => providerLabels[id] ?? id.charAt(0).toUpperCase() + id.slice(1)

const resetPhrase = (text: string) => /\b(?:resets?|try again)\s+((?:in|at|on)\s+[^.,;]+)/iu.exec(text)?.[1]?.trim()

interface Input {
  readonly kind: string
  readonly text: string
  readonly provider: string
  readonly model: string
  readonly midTurn: boolean
  readonly admin: boolean
}

const elsewhere = (provider: string) =>
  `pick a model from ${provider === "the model provider" ? "another provider" : `a provider other than ${provider}`}`

const outOfCredits = (input: Input): Problem => {
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

const usageLimit = (input: Input): Problem => {
  const reset = resetPhrase(input.text)
  return {
    title: `You’ve hit your ${input.provider} usage limit.`,
    fix: `${reset ? `It resets ${reset}.` : "It resets soon."} To keep going now, ${elsewhere(input.provider)}.`,
    actions: ["model", "try"],
  }
}

const unavailableModel = (input: Input): Problem => ({
  title: `${input.model} isn’t available right now.`,
  fix: "Pick another model to keep going.",
  actions: ["model"],
})

const byText: ReadonlyArray<{ readonly test: (text: string) => boolean; readonly problem: (input: Input) => Problem }> =
  [
    { test: (text) => /budget/iu.test(text) && /exceed/iu.test(text), problem: outOfCredits },
    { test: (text) => /usage limit|weekly limit|plan limit/iu.test(text), problem: usageLimit },
    {
      test: (text) =>
        /not supported when using .* account|not included in your plan|your plan does not|not available on your plan/iu.test(
          text,
        ),
      problem: (input) => ({
        title: `${input.model} isn’t included in your ${input.provider} plan.`,
        fix: "Pick another model to keep going, or upgrade your plan.",
        actions: ["model"],
      }),
    },
    {
      test: (text) => /do not have access to it|does not have access to (the )?model/iu.test(text),
      problem: (input) => ({
        title: `Your ${input.provider} account doesn’t have access to ${input.model}.`,
        fix: "Pick another model to keep going.",
        actions: ["model"],
      }),
    },
    {
      test: (text) => /model_not_found|does not exist|no such model|model not found/iu.test(text),
      problem: unavailableModel,
    },
    {
      test: (text) => /context length|context window|too long|maximum context/iu.test(text),
      problem: (input) => ({
        title: `This chat is too long for ${input.model}.`,
        fix: "Start a new chat, or pick a model that can handle more.",
        actions: ["new", "model"],
      }),
    },
    {
      test: (text) => /temporarily unavailable|not available now/iu.test(text),
      problem: (input) => ({
        title: `Your ${input.provider} account is temporarily unavailable.`,
        fix: "Give it a few minutes, then try again.",
        actions: ["try"],
      }),
    },
    {
      test: (text) => /subscription/iu.test(text) && /inactive|expired|cancel|not active|payment/iu.test(text),
      problem: (input) => ({
        title: `Your ${input.provider} subscription isn’t active.`,
        fix: `Renew it, or ${elsewhere(input.provider)}.`,
        actions: ["model", "try"],
      }),
    },
  ]

const noResponse = (input: Input): Problem => ({
  title: `${input.provider} didn’t respond.`,
  fix: `Try again, or ${elsewhere(input.provider)}.`,
  actions: ["try", "model"],
})

const byKind: Readonly<Record<string, (input: Input) => Problem>> = {
  "provider.free-limit": (input) => ({
    title: `${input.model} isn’t included in your plan.`,
    fix: "Pick another model to keep going.",
    actions: ["model"],
  }),
  "provider.quota": (input) => ({
    title: `${input.provider} models are down on our side.`,
    fix: `We’re on it. In the meantime, ${elsewhere(input.provider)}.`,
    actions: ["model"],
  }),
  "provider.rate-limit": (input) => ({
    title: `${input.provider} is getting too many requests.`,
    fix: `Wait a minute and try again, or ${elsewhere(input.provider)}.`,
    actions: ["try", "model"],
  }),
  "provider.auth": (input) =>
    input.admin
      ? {
          title: `Ren lost access to your ${input.provider} account.`,
          fix: "Reconnect it in Providers, then try again.",
          actions: ["providers", "try"],
        }
      : {
          title: `Ren lost access to the ${input.provider} account.`,
          fix: "Ask an admin to reconnect it, or pick another model.",
          actions: ["model"],
        },
  "provider.no-route": unavailableModel,
  "provider.content-filter": (input) => ({
    title: `${input.provider} blocked this message.`,
    fix: "Try rewording it.",
    actions: ["try"],
  }),
  "provider.timeout": noResponse,
  "provider.transport": noResponse,
  "provider.internal": noResponse,
}

const fallback: Problem = { title: "Ren couldn’t finish that reply.", fix: "Try again.", actions: ["try"] }

const problemOf = (input: Input): Problem =>
  byText.find((rule) => rule.test(input.text))?.problem(input) ?? byKind[input.kind]?.(input) ?? fallback

const labels: Record<Action, string> = {
  try: "Try again",
  continue: "Continue",
  model: "Change model",
  providers: "Providers",
  new: "New chat",
  stop: "Stop",
}

function ActionButton(props: { action: Action; primary: boolean; handlers: Handlers }) {
  const variant = props.primary ? "default" : "ghost"
  const className = props.primary ? undefined : "text-muted-foreground"
  if (props.action === "providers" || props.action === "new")
    return (
      <Link
        to={props.action === "providers" ? "/settings/providers" : "/"}
        className={buttonVariants({ variant, size: "sm", className })}
      >
        {labels[props.action]}
        <IconArrowUpRight data-icon="inline-end" />
      </Link>
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
  icon: ReactNode
  waiting?: boolean
  title: string
  fix: ReactNode
  actions: ReadonlyArray<Action>
  handlers: Handlers
  details: string | undefined
}) {
  return (
    <Alert
      role={props.waiting ? "status" : "alert"}
      className={
        props.waiting
          ? "animate-in gap-x-3 rounded-none border-0 bg-transparent px-0 py-1 duration-200 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none *:[svg]:text-muted-foreground"
          : "animate-in gap-x-3 rounded-none border-0 bg-transparent px-0 py-1 duration-200 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none *:[svg]:text-destructive"
      }
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

export function TurnFailed(props: {
  kind: string
  text: string
  provider: string
  model: string
  midTurn: boolean
  admin: boolean
  handlers: Handlers
}) {
  const problem = problemOf({ ...props, provider: providerLabel(props.provider) })
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

export function TurnRetrying(props: {
  text: string
  provider: string
  next: number
  attempt: number
  handlers: Handlers
}) {
  const seconds = Countdown.useUntil(props.next)
  const busy = /rate|busy|overload|too many/iu.test(props.text) && !/usage limit|weekly/iu.test(props.text)
  return (
    <Shell
      icon={<Spinner />}
      waiting
      title={
        busy
          ? `${providerLabel(props.provider)} is busy right now.`
          : `${providerLabel(props.provider)} isn’t responding.`
      }
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
