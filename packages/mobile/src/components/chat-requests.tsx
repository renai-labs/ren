import { ChatReact } from "@ren/chat/react"
import { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import { Session } from "@ren/schema/session"
import IconX from "@tabler/icons-react-native/IconX"
import { type ReactNode, useState } from "react"
import { Pressable, ScrollView, View } from "react-native"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Input } from "#components/input"
import { Text } from "#components/text"

function Card(props: { readonly from: string | undefined; readonly error: string; readonly children: ReactNode }) {
  return (
    <View className="mx-3 mb-2 gap-3 rounded-xl border border-border bg-card p-3">
      {props.from ? <Text variant="muted">{props.from} needs your input</Text> : null}
      {props.children}
      {props.error ? <Text className="text-sm text-destructive">{props.error}</Text> : null}
    </View>
  )
}

function Question(props: {
  readonly field: Form.Question
  readonly picked: ReadonlyArray<string>
  readonly other: string
  readonly onPick: (picked: ReadonlyArray<string>) => void
  readonly onOther: (text: string) => void
}) {
  const field = props.field
  const options = field.options ?? []
  const toggle = (value: string) => {
    if (field.type !== "multiselect") return props.onPick(props.picked.includes(value) ? [] : [value])
    return props.onPick(
      props.picked.includes(value) ? props.picked.filter((each) => each !== value) : [...props.picked, value],
    )
  }
  return (
    <View className="gap-2">
      <Text className="font-medium">{field.description ?? field.title ?? "Your answer"}</Text>
      {field.type === "multiselect" ? <Text variant="muted">Select all that apply.</Text> : null}
      {options.map((option) => (
        <Pressable
          key={option.value}
          role={field.type === "multiselect" ? "checkbox" : "radio"}
          aria-checked={props.picked.includes(option.value)}
          className={
            props.picked.includes(option.value)
              ? "gap-0.5 rounded-md border border-primary bg-accent px-3 py-2"
              : "gap-0.5 rounded-md border border-border px-3 py-2"
          }
          onPress={() => toggle(option.value)}
        >
          <Text>{option.label}</Text>
          {option.description ? <Text variant="muted">{option.description}</Text> : null}
        </Pressable>
      ))}
      {field.custom === false && options.length > 0 ? null : (
        <Input
          value={props.other}
          onChangeText={props.onOther}
          placeholder="Something else…"
          aria-label="Your answer"
        />
      )}
    </View>
  )
}

function QuestionCard(props: {
  readonly form: Form.Info
  readonly expired: boolean
  readonly pending: boolean
  readonly onSubmit: (answer: Form.Answer) => void
  readonly onDismiss: () => void
}) {
  const [picked, setPicked] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({})
  const [other, setOther] = useState<Readonly<Record<string, string>>>({})
  const questions = props.form.fields.filter(Form.isQuestion)
  const answer = Form.answer(props.form, (key) => [...(picked[key] ?? []), other[key] ?? ""])
  const complete = questions.every((field) => field.required !== true || Object.hasOwn(answer, field.key))
  return (
    <>
      <View className="flex-row items-center justify-between">
        <Text className="font-semibold">{questions.length > 1 ? "Ren has a few questions" : "Ren has a question"}</Text>
        <Button variant="ghost" size="icon" aria-label="Dismiss" disabled={props.pending} onPress={props.onDismiss}>
          <Icon as={IconX} />
        </Button>
      </View>
      {props.expired ? (
        <Text variant="muted">This question expired. Your answer goes to the chat as a new message.</Text>
      ) : null}
      <ScrollView className="max-h-96" contentContainerClassName="gap-4" keyboardShouldPersistTaps="handled">
        {questions.map((field) => (
          <Question
            key={field.key}
            field={field}
            picked={picked[field.key] ?? []}
            other={other[field.key] ?? ""}
            onPick={(next) => setPicked({ ...picked, [field.key]: next })}
            onOther={(text) => setOther({ ...other, [field.key]: text })}
          />
        ))}
      </ScrollView>
      <Button disabled={props.pending || !complete} onPress={() => props.onSubmit(answer)}>
        <Text>Send</Text>
      </Button>
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
  const [sending, setSending] = useState<string>()
  const [error, setError] = useState("")
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
  const settle = (id: string, request: () => Promise<unknown>, failure: string) => {
    if (sending === id) return
    setSending(id)
    setError("")
    void request()
      .catch(() => setError(failure))
      .finally(() => setSending((current) => (current === id ? undefined : current)))
  }

  const permission = props.permission
  if (permission)
    return (
      <Card from={permission.sessionID === props.viewed ? undefined : props.permissionTitle} error={error}>
        <Text className="font-semibold">Allow {permission.action}?</Text>
        {permission.resources.length > 0 ? (
          <Text variant="muted" className="font-mono text-xs">
            {permission.resources.join("\n")}
          </Text>
        ) : null}
        {permission.message ? <Text variant="muted">{permission.message}</Text> : null}
        <View className="flex-row gap-2">
          {(
            [
              { reply: "reject", label: "Deny", variant: "outline" },
              { reply: "always", label: "Always allow", variant: "outline" },
              { reply: "once", label: "Allow", variant: "default" },
            ] as const
          ).map((choice) => (
            <Button
              key={choice.reply}
              variant={choice.variant}
              className="flex-1"
              disabled={sending === permission.id}
              onPress={() =>
                settle(
                  permission.id,
                  () => replyPermission([permission.sessionID, permission.id, choice.reply]),
                  "Couldn’t answer the request. Try again.",
                )
              }
            >
              <Text>{choice.label}</Text>
            </Button>
          ))}
        </View>
      </Card>
    )

  const form = props.form
  if (!form) return null
  const owner = Session.ID.make(form.sessionID)
  const from = form.sessionID === props.viewed ? undefined : props.formTitle
  if (form.kind === "websearch.provider")
    return (
      <Card from={from} error={error}>
        <Text className="font-semibold">Allow web search?</Text>
        <Text variant="muted">Ren wants to search the web for this chat.</Text>
        <View className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={sending === form.id}
            onPress={() =>
              settle(form.id, () => replyWebSearch(form, false), "Couldn’t answer the request. Try again.")
            }
          >
            <Text>Not now</Text>
          </Button>
          <Button
            className="flex-1"
            disabled={sending === form.id}
            onPress={() =>
              settle(form.id, () => replyWebSearch(form, "random"), "Couldn’t answer the request. Try again.")
            }
          >
            <Text>Enable</Text>
          </Button>
        </View>
      </Card>
    )
  return (
    <Card from={from} error={error}>
      <QuestionCard
        key={form.id}
        form={form}
        expired={props.formExpired}
        pending={sending === form.id}
        onSubmit={(answer) =>
          settle(form.id, () => replyForm([owner, form.id, answer]), "Couldn’t send your answer. Try again.")
        }
        onDismiss={() =>
          settle(form.id, () => cancelForm([owner, form.id]), "Couldn’t dismiss the question. Try again.")
        }
      />
    </Card>
  )
}

export { ChatRequests }
