import { ChatReact } from "@ren/chat/react"
import { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import { Session } from "@ren/schema/session"
import { ErrorText } from "@ren/util/error-text"
import IconGhostFilled from "@tabler/icons-react-native/IconGhostFilled"
import IconX from "@tabler/icons-react-native/IconX"
import { cn } from "cn"
import { type ReactNode, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native"
import CheckIcon from "react-native-heroicons/mini/CheckIcon"
import GlobeAltIcon from "react-native-heroicons/mini/GlobeAltIcon"
import ShieldExclamationIcon from "react-native-heroicons/mini/ShieldExclamationIcon"
import { useKeyboardState } from "react-native-keyboard-controller"
import { Appear } from "#components/appear"
import { Button } from "#components/button"
import { CodeBlock } from "#components/code-block"
import { Icon } from "#components/icon"
import { Input } from "#components/input"
import { Text } from "#components/text"

function Card(props: {
  readonly label: string
  readonly from: string | undefined
  readonly error: string | undefined
  readonly className: string
  readonly children: ReactNode
}) {
  return (
    <Appear className="mx-3 mb-2 gap-2">
      {props.from ? (
        <View className="flex-row items-center gap-2 px-1">
          <Icon as={IconGhostFilled} className="size-4 text-muted-foreground" />
          <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
            {props.from} needs your input
          </Text>
        </View>
      ) : null}
      <View
        aria-label={props.label}
        className={cn("gap-3 border border-border bg-card shadow-soft dark:shadow-none", props.className)}
      >
        {props.children}
        {props.error ? <Text className="text-sm text-destructive">{props.error}</Text> : null}
      </View>
    </Appear>
  )
}

function Busy(props: { readonly className: string }) {
  return <ActivityIndicator size="small" colorClassName={props.className} />
}

function PermissionCard(props: {
  readonly request: Permission.Request
  readonly pressed: string | undefined
  readonly onReply: (reply: Permission.Reply) => void
}) {
  const request = props.request
  const pending = Boolean(props.pressed)
  return (
    <>
      <View className="flex-row items-start gap-3">
        <View className="size-8 items-center justify-center rounded-lg bg-muted">
          <Icon as={ShieldExclamationIcon} className="size-4 text-chart-3" />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-medium">Allow Ren to {request.action}?</Text>
          <Text variant="muted">
            {request.message ?? "Ren asks before it does this. You can allow it once or every time."}
          </Text>
        </View>
      </View>
      {request.resources.length > 0 ? (
        <CodeBlock maxHeight={128} className="ml-11">
          {request.resources.join("\n")}
        </CodeBlock>
      ) : null}
      <View className="gap-2">
        <Button disabled={pending} onPress={() => props.onReply("once")}>
          {props.pressed === "once" ? <Busy className="accent-primary-foreground" /> : null}
          <Text>Allow once</Text>
        </Button>
        <View className="flex-row gap-2">
          <Button variant="outline" className="flex-1" disabled={pending} onPress={() => props.onReply("always")}>
            {props.pressed === "always" ? <Busy className="accent-muted-foreground" /> : null}
            <Text>Always allow</Text>
          </Button>
          <Button variant="ghost" className="flex-1" disabled={pending} onPress={() => props.onReply("reject")}>
            {props.pressed === "reject" ? <Busy className="accent-muted-foreground" /> : null}
            <Text className="text-muted-foreground">Deny</Text>
          </Button>
        </View>
      </View>
    </>
  )
}

function Choice(props: {
  readonly multiple: boolean
  readonly checked: boolean
  readonly disabled: boolean
  readonly option: Form.Option
  readonly onPress: () => void
}) {
  return (
    <Pressable
      role={props.multiple ? "checkbox" : "radio"}
      aria-checked={props.checked}
      disabled={props.disabled}
      className={cn(
        "min-h-11 flex-row items-start gap-2.5 rounded-lg border px-3 py-2.5",
        props.checked ? "border-primary/40 bg-muted" : "border-input active:bg-muted/50",
        props.disabled && "opacity-50",
      )}
      onPress={props.onPress}
    >
      <View
        className={cn(
          "mt-0.5 size-4 items-center justify-center border",
          props.multiple ? "rounded-sm" : "rounded-full",
          props.checked ? "border-primary bg-primary" : "border-input",
        )}
      >
        {props.checked && props.multiple ? <Icon as={CheckIcon} className="size-3.5 text-primary-foreground" /> : null}
        {props.checked && !props.multiple ? <View className="size-2 rounded-full bg-primary-foreground" /> : null}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-sm leading-snug font-medium">{props.option.label}</Text>
        {props.option.description ? <Text variant="muted">{props.option.description}</Text> : null}
      </View>
    </Pressable>
  )
}

function Question(props: {
  readonly field: Form.Question
  readonly title: string
  readonly picked: ReadonlyArray<string>
  readonly other: string
  readonly invalid: boolean
  readonly disabled: boolean
  readonly onPick: (value: string) => void
  readonly onType: (text: string) => void
}) {
  const field = props.field
  const options = field.options ?? []
  const screen = useWindowDimensions().height
  const keyboard = useKeyboardState((state) => state.height)
  return (
    <>
      <View className="gap-1">
        <Text className="leading-snug font-medium">{field.description ?? field.title ?? props.title}</Text>
        {field.type === "multiselect" ? <Text variant="muted">Select all that apply.</Text> : null}
      </View>
      {options.length > 0 ? (
        <ScrollView
          className="grow-0"
          style={{ maxHeight: (screen - keyboard) * 0.3 }}
          contentContainerClassName="gap-2"
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {options.map((option) => (
            <Choice
              key={option.value}
              multiple={field.type === "multiselect"}
              checked={props.picked.includes(option.value)}
              disabled={props.disabled}
              option={option}
              onPress={() => props.onPick(option.value)}
            />
          ))}
        </ScrollView>
      ) : null}
      {field.custom === false && options.length > 0 ? null : (
        <Input
          value={props.other}
          onChangeText={props.onType}
          placeholder="Something else…"
          aria-label="Type your own answer"
          editable={!props.disabled}
        />
      )}
      {props.invalid ? (
        <Text role="alert" className="text-sm text-destructive">
          {field.required === true ? "Choose an answer to continue." : "Choose an answer or skip this question."}
        </Text>
      ) : null}
    </>
  )
}

function QuestionCard(props: {
  readonly form: Form.Info
  readonly expired: boolean
  readonly pressed: string | undefined
  readonly onSubmit: (answer: Form.Answer) => void
  readonly onDismiss: () => void
}) {
  const pending = Boolean(props.pressed)
  const questions = props.form.fields.filter(Form.isQuestion)
  const [at, setAt] = useState(0)
  const [picked, setPicked] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({})
  const [other, setOther] = useState<Readonly<Record<string, string>>>({})
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set())
  const [tried, setTried] = useState<ReadonlySet<string>>(() => new Set())
  const answerOf = (skip: ReadonlySet<string>) =>
    Form.answer(props.form, (key) => (skip.has(key) ? [] : [...(picked[key] ?? []), other[key] ?? ""]))
  const answer = answerOf(skipped)
  const settled = (field: Form.Question, skip: ReadonlySet<string>, given: Form.Answer) =>
    Object.hasOwn(given, field.key) || (skip.has(field.key) && field.required !== true)
  const field = questions[at]
  if (!field) return null
  const key = field.key
  const multiple = field.type === "multiselect"
  const last = at === questions.length - 1
  const answering = () => setSkipped((current) => new Set([...current].filter((each) => each !== key)))
  const pick = (value: string) => {
    const current = picked[key] ?? []
    answering()
    if (!multiple) setOther({ ...other, [key]: "" })
    if (!multiple) return setPicked({ ...picked, [key]: [value] })
    setPicked({
      ...picked,
      [key]: current.includes(value) ? current.filter((each) => each !== value) : [...current, value],
    })
  }
  const type = (text: string) => {
    answering()
    setOther({ ...other, [key]: text })
    if (!multiple && text.trim()) setPicked({ ...picked, [key]: [] })
  }
  const finish = (skip: ReadonlySet<string>) => {
    const given = answerOf(skip)
    const missing = questions.findIndex((each) => !settled(each, skip, given))
    const blocked = questions[missing]
    if (!blocked) return props.onSubmit(given)
    setAt(missing)
    setTried(new Set([...tried, blocked.key]))
  }
  const next = () => {
    if (!settled(field, skipped, answer)) return setTried(new Set([...tried, key]))
    if (last) return finish(skipped)
    setAt(at + 1)
  }
  const skip = () => {
    const marked = new Set([...skipped, key])
    setSkipped(marked)
    setPicked({ ...picked, [key]: [] })
    setOther({ ...other, [key]: "" })
    if (last) return finish(marked)
    setAt(at + 1)
  }
  return (
    <>
      <View className="flex-row items-start gap-2">
        <View className="min-w-0 flex-1 gap-1 pt-2">
          <Text className="font-medium">{questions.length > 1 ? "Ren has a few questions" : "Ren has a question"}</Text>
          {props.expired ? (
            <Text variant="muted">This question expired. Your answer goes to the chat as a new message.</Text>
          ) : null}
        </View>
        <Button
          variant="ghost"
          size="icon"
          hitSlop={2}
          aria-label="Dismiss"
          disabled={pending}
          onPress={props.onDismiss}
        >
          {props.pressed === "dismiss" ? (
            <Busy className="accent-muted-foreground" />
          ) : (
            <Icon as={IconX} className="size-4 text-muted-foreground" />
          )}
        </Button>
      </View>
      <View className="gap-3">
        {questions.length > 1 ? (
          <Text className="text-xs font-medium text-muted-foreground tabular-nums">
            Question {at + 1} of {questions.length}
          </Text>
        ) : null}
        <Question
          field={field}
          title={props.form.title}
          picked={picked[key] ?? []}
          other={other[key] ?? ""}
          invalid={tried.has(key) && !settled(field, skipped, answer)}
          disabled={pending}
          onPick={pick}
          onType={type}
        />
      </View>
      <QuestionActions
        last={last}
        pressed={props.pressed}
        onBack={at > 0 ? () => setAt(at - 1) : undefined}
        onSkip={field.required === true ? undefined : skip}
        onNext={next}
      />
    </>
  )
}

function QuestionActions(props: {
  readonly last: boolean
  readonly pressed: string | undefined
  readonly onBack: (() => void) | undefined
  readonly onSkip: (() => void) | undefined
  readonly onNext: () => void
}) {
  const pending = Boolean(props.pressed)
  return (
    <View className="flex-row items-center gap-2">
      {props.onBack ? (
        <Button variant="outline" disabled={pending} onPress={props.onBack}>
          <Text>Back</Text>
        </Button>
      ) : null}
      <View className="flex-1" />
      {props.onSkip ? (
        <Button variant="outline" disabled={pending} onPress={props.onSkip}>
          <Text>Skip</Text>
        </Button>
      ) : null}
      <Button disabled={pending} onPress={props.onNext}>
        {props.pressed === "send" ? <Busy className="accent-primary-foreground" /> : null}
        <Text>{props.last ? "Send" : "Next"}</Text>
      </Button>
    </View>
  )
}

function WebSearchCard(props: {
  readonly pressed: string | undefined
  readonly onAnswer: (selection: string | false) => void
}) {
  const pending = Boolean(props.pressed)
  return (
    <>
      <View className="flex-row items-start gap-2.5">
        <Icon as={GlobeAltIcon} className="mt-0.5 size-4" />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-sm leading-snug font-medium">Allow web search?</Text>
          <Text variant="muted">Ren wants to search the web for this chat.</Text>
        </View>
      </View>
      <View className="flex-row justify-end gap-2">
        <Button variant="outline" size="sm" disabled={pending} onPress={() => props.onAnswer(false)}>
          {props.pressed === "later" ? <Busy className="accent-muted-foreground" /> : null}
          <Text className="text-sm">Not now</Text>
        </Button>
        <Button size="sm" disabled={pending} onPress={() => props.onAnswer("random")}>
          {props.pressed === "enable" ? <Busy className="accent-primary-foreground" /> : null}
          <Text className="text-sm">Enable</Text>
        </Button>
      </View>
    </>
  )
}

function ChatRequests(props: {
  readonly root: Session.ID
  readonly viewed: Session.ID
  readonly permission: Permission.Request | undefined
  readonly permissionTitle: string
  readonly form: Form.Info | undefined
  readonly formTitle: string
  readonly formExpired: boolean
}) {
  const [sending, setSending] = useState<{ readonly id: string; readonly choice: string }>()
  const [failure, setFailure] = useState<{ readonly id: string; readonly text: string }>()
  const replyPermission = ChatReact.useAction(props.root, (opened, reply: Parameters<typeof opened.replyPermission>) =>
    opened.replyPermission(...reply),
  )
  const replyForm = ChatReact.useAction(props.root, (opened, reply: Parameters<typeof opened.replyForm>) =>
    opened.replyForm(...reply),
  )
  const cancelForm = ChatReact.useAction(props.root, (opened, cancel: Parameters<typeof opened.cancelForm>) =>
    opened.cancelForm(...cancel),
  )
  const replyWebSearch = ChatReact.useAction(props.root, (opened, form: Form.Info, selection: string | false) =>
    opened.replyWebSearch(form, selection),
  )
  const settle = (id: string, choice: string, request: () => Promise<unknown>, fallback: string) => {
    if (sending?.id === id) return
    setSending({ id, choice })
    setFailure(undefined)
    void request()
      .catch((error: unknown) => setFailure({ id, text: ErrorText.of(error, fallback) }))
      .finally(() => setSending((current) => (current?.id === id ? undefined : current)))
  }
  const pressedOn = (id: string) => (sending?.id === id ? sending.choice : undefined)
  const errorOf = (id: string) => (failure?.id === id ? failure.text : undefined)

  const permission = props.permission
  if (permission)
    return (
      <Card
        label="Permission request"
        from={permission.sessionID === props.viewed ? undefined : props.permissionTitle}
        error={errorOf(permission.id)}
        className="rounded-xl p-4"
      >
        <PermissionCard
          key={permission.id}
          request={permission}
          pressed={pressedOn(permission.id)}
          onReply={(reply) =>
            settle(
              permission.id,
              reply,
              () => replyPermission([permission.sessionID, permission.id, reply]),
              "Couldn’t answer the request. Try again.",
            )
          }
        />
      </Card>
    )

  const form = props.form
  if (!form) return null
  const owner = Session.ID.make(form.sessionID)
  const from = form.sessionID === props.viewed ? undefined : props.formTitle
  if (form.kind === "websearch.provider")
    return (
      <Card label="Web search request" from={from} error={errorOf(form.id)} className="rounded-lg px-3 py-2.5">
        <WebSearchCard
          pressed={pressedOn(form.id)}
          onAnswer={(selection) =>
            settle(
              form.id,
              selection === false ? "later" : "enable",
              () => replyWebSearch(form, selection),
              "Couldn’t answer the request. Try again.",
            )
          }
        />
      </Card>
    )
  return (
    <Card label="Question" from={from} error={errorOf(form.id)} className="rounded-xl p-3">
      <QuestionCard
        key={form.id}
        form={form}
        expired={props.formExpired}
        pressed={pressedOn(form.id)}
        onSubmit={(answer) =>
          settle(form.id, "send", () => replyForm([owner, form.id, answer]), "Couldn’t send your answer. Try again.")
        }
        onDismiss={() =>
          settle(form.id, "dismiss", () => cancelForm([owner, form.id]), "Couldn’t dismiss the question. Try again.")
        }
      />
    </Card>
  )
}

export { ChatRequests }
