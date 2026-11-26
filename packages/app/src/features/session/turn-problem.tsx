import { Link } from "@tanstack/react-router"
import { IconAlertCircle, IconArrowUpRight, IconChevronRight } from "@tabler/icons-react"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Spinner } from "@ren/ui/spinner"
import { cn } from "cn"
import type { TurnProblems } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"

const labels: Record<TurnProblems.Action, string> = {
  try: "Try again",
  continue: "Continue",
  model: "Change model",
  billing: "Add credits",
  providers: "Providers",
  new: "New chat",
  stop: "Stop",
}

function ActionButton(props: { action: TurnProblems.Action; primary: boolean; handlers: TurnProblems.Handlers }) {
  const variant = props.primary ? "default" : "ghost"
  const className = props.primary ? undefined : "text-muted-foreground"
  if (props.action === "billing")
    return (
      <Link to="/settings/billing" className={buttonVariants({ variant, size: "sm", className })}>
        {labels.billing}
        <IconArrowUpRight data-icon="inline-end" />
      </Link>
    )
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
  actions: ReadonlyArray<TurnProblems.Action>
  handlers: TurnProblems.Handlers
  details?: string | undefined
}) {
  return (
    <Alert
      data-chat-part="turn-problem"
      data-waiting={props.waiting || undefined}
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

export function TurnProblem(props: { problem: TurnProblems.Problem; text: string; handlers: TurnProblems.Handlers }) {
  return (
    <Shell
      icon={<IconAlertCircle />}
      title={props.problem.title}
      fix={props.problem.fix}
      actions={props.problem.actions}
      handlers={props.handlers}
      details={props.text.trim() || undefined}
    />
  )
}

export function TurnRetrying(props: { retrying: TurnProblems.Retrying; handlers: TurnProblems.Handlers }) {
  const seconds = ChatReact.useSecondsUntil(props.retrying.at)
  return (
    <Shell
      icon={<Spinner />}
      waiting
      title={props.retrying.title}
      fix={
        <span className="tabular-nums">
          {seconds > 0 ? `Trying again in ${seconds}s…` : "Trying again now…"}
          {props.retrying.attempt > 1 ? ` (attempt ${props.retrying.attempt})` : null}
        </span>
      }
      actions={["stop"]}
      handlers={props.handlers}
      details={props.retrying.text.trim() || undefined}
    />
  )
}
