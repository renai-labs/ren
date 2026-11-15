import type { TurnProblems } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { useRouter } from "expo-router"
import { type ReactNode, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import ChevronDownIcon from "react-native-heroicons/mini/ChevronDownIcon"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import ExclamationCircleIcon from "react-native-heroicons/mini/ExclamationCircleIcon"
import { Button } from "#components/button"
import { CodeBlock } from "#components/code-block"
import { Icon } from "#components/icon"
import { Text } from "#components/text"

const labels: Partial<Record<TurnProblems.Action, string>> = {
  try: "Try again",
  continue: "Continue",
  new: "New chat",
  stop: "Stop",
}

function Problem(props: {
  readonly icon: ReactNode
  readonly title: string
  readonly fix: string
  readonly actions: ReadonlyArray<TurnProblems.Action>
  readonly handlers: TurnProblems.Handlers
  readonly details: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const handlers: Partial<Record<TurnProblems.Action, (() => void) | undefined>> = {
    try: props.handlers.onTryAgain,
    continue: props.handlers.onContinue,
    stop: props.handlers.onStop,
    new: () => router.navigate("/"),
  }
  const actions = props.actions.flatMap((action) => {
    const onPress = handlers[action]
    const label = labels[action]
    return onPress && label ? [{ action, label, onPress }] : []
  })
  const details = props.details.trim()
  return (
    <View className="flex-row gap-3 py-1">
      <View className="pt-0.5">{props.icon}</View>
      <View className="flex-1 gap-1">
        <Text className="text-sm font-medium">{props.title}</Text>
        <Text className="text-sm text-muted-foreground tabular-nums">{props.fix}</Text>
        {actions.length > 0 || details ? (
          <View className="flex-row flex-wrap items-center gap-1 pt-2">
            {actions.map((item, index) => (
              <Button key={item.action} variant={index === 0 ? "default" : "ghost"} size="sm" onPress={item.onPress}>
                <Text className={index === 0 ? "text-sm" : "text-sm text-muted-foreground"}>{item.label}</Text>
              </Button>
            ))}
            {details ? (
              <Button variant="ghost" size="sm" aria-expanded={open} onPress={() => setOpen(!open)}>
                <Text className="text-sm text-muted-foreground">Details</Text>
                <Icon as={open ? ChevronDownIcon : ChevronRightIcon} className="size-4 text-muted-foreground" />
              </Button>
            ) : null}
          </View>
        ) : null}
        {open && details ? <CodeBlock>{details}</CodeBlock> : null}
      </View>
    </View>
  )
}

function TurnProblem(props: {
  readonly problem: TurnProblems.Problem
  readonly text: string
  readonly handlers: TurnProblems.Handlers
}) {
  return (
    <Problem
      icon={<Icon as={ExclamationCircleIcon} className="size-5 text-destructive" />}
      title={props.problem.title}
      fix={props.problem.fix}
      actions={props.problem.actions}
      handlers={props.handlers}
      details={props.text}
    />
  )
}

function TurnRetrying(props: { readonly retrying: TurnProblems.Retrying; readonly handlers: TurnProblems.Handlers }) {
  const seconds = ChatReact.useSecondsUntil(props.retrying.at)
  const attempt = props.retrying.attempt > 1 ? ` (attempt ${props.retrying.attempt})` : ""
  return (
    <Problem
      icon={<ActivityIndicator colorClassName="accent-muted-foreground" size="small" className="size-5" />}
      title={props.retrying.title}
      fix={`${seconds > 0 ? `Trying again in ${seconds}s…` : "Trying again now…"}${attempt}`}
      actions={["stop"]}
      handlers={props.handlers}
      details={props.retrying.text}
    />
  )
}

export { TurnProblem, TurnRetrying }
