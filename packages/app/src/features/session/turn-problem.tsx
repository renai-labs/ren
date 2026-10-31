import { Link } from "@tanstack/react-router"
import { IconAlertCircle, IconArrowUpRight, IconChevronRight } from "@tabler/icons-react"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Spinner } from "@ren/ui/spinner"
import { cn } from "cn"
import { useSecondsUntil } from "../../lib/use-seconds-until.js"
import { problemOf, type ProblemAction, type ProblemHandlers } from "./turn-problems.js"

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
      <Link to="/settings/providers" className={buttonVariants({ variant, size: "sm", className })}>
        {labels.providers}
        <IconArrowUpRight data-icon="inline-end" />
      </Link>
    )
  if (props.action === "new")
    return (
      <Link to="/" className={buttonVariants({ variant, size: "sm", className })}>
        {labels.new}
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
