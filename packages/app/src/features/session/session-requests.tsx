import { WebSearch } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import { Session } from "@ren/schema/session"
import { Button } from "@ren/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@ren/ui/card"
import { InputGroup, InputGroupInput } from "@ren/ui/input-group"
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from "@ren/ui/item"
import { useMessageScroller } from "@ren/ui/message-scroller"
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@ren/ui/questionnaire"
import { Spinner } from "@ren/ui/spinner"
import { IconGhost, IconShieldQuestion, IconX } from "@tabler/icons-react"
import { WebSearchConsent, type WebSearchProvider, type WebSearchProviders } from "@ren/ui/web-search-consent"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import type { ReactNode } from "react"
import { Chat } from "../../lib/chat.js"
import { Failure } from "./failure.js"
import { FormProgress } from "../../lib/form-progress.js"
import { Requests } from "./requests.js"

function Source(props: {
  title: string
  sessionID: Session.ID
  viewed: Session.ID
  onOpen: (sessionID: Session.ID) => void
  children: ReactNode
}) {
  if (props.sessionID === props.viewed) return props.children
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground">
        <IconGhost className="size-4 shrink-0" />
        <span className="truncate">{props.title} needs your input</span>
        <Button variant="ghost" size="xs" className="ml-auto" onClick={() => props.onOpen(props.sessionID)}>
          Open subagent
        </Button>
      </div>
      {props.children}
    </div>
  )
}

const anyProvider: WebSearchProvider = { value: "random", label: "Any" }

interface DockProps {
  form: Form.Info
  value: string
  failed: boolean
  pending: boolean
  disabled: boolean
  onValueChange: (value: string) => void
  onSubmit: (selection: string | false) => void
}

const providerState = (result: AsyncResult.AsyncResult<unknown, unknown>): WebSearchProviders => {
  if (AsyncResult.isFailure(result)) return "failed"
  return AsyncResult.isSuccess(result) ? "ready" : "loading"
}

function ConsentDock(props: DockProps & { root: Session.ID }) {
  const providers = ChatReact.useWebSearchProviders(props.root, Session.ID.make(props.form.sessionID))
  const listed = AsyncResult.isSuccess(providers.result)
    ? providers.result.value.map((provider) => ({ value: provider.id, label: provider.name }))
    : []
  const options = [anyProvider, ...listed]
  const selected = WebSearch.selected(props.form, options, props.value)
  return (
    <WebSearchConsent
      providers={listed.length > 0 ? options : []}
      providerState={providerState(providers.result)}
      value={selected}
      failed={props.failed}
      pending={props.pending}
      disabled={props.disabled}
      onValueChange={props.onValueChange}
      onEnable={() => {
        if (selected) props.onSubmit(selected)
      }}
      onDisable={() => props.onSubmit(false)}
      onRetry={providers.retry}
    />
  )
}

function ProviderDock(props: DockProps) {
  const options = (WebSearch.providerField(props.form)?.options ?? []).map((option) => ({
    value: option.value,
    label: option.label,
  }))
  const selected = WebSearch.selected(props.form, options, props.value)
  return (
    <WebSearchConsent
      providers={options}
      providerState="ready"
      value={selected}
      failed={props.failed}
      pending={props.pending}
      disabled={props.disabled}
      onValueChange={props.onValueChange}
      onEnable={() => {
        if (selected) props.onSubmit(selected)
      }}
      onRetry={() => undefined}
    />
  )
}

function SessionWebSearch(props: {
  root: Session.ID
  sessionID: Session.ID
  form: Form.Info | undefined
  title: string
  connection: number
  covered: boolean
  onOpen: (sessionID: Session.ID) => void
  onAnswered: () => void
}) {
  const [choice, setChoice] = useState<Requests.WebSearchChoice>()
  const [sending, setSending] = useState<Requests.WebSearchSending & { readonly title: string }>()
  const status = ChatReact.useStatus(props.root)
  const connected = AsyncResult.isSuccess(status) && status.value === "connected"
  const reply = ChatReact.useAction(props.root, (opened, form: Form.Info, selection: string | false) =>
    opened.replyWebSearch(form, selection),
  )
  const owner = props.sessionID
  const request = Requests.webSearchRequest(sending, props.form, owner, props.connection)
  const form = request.form
  if (!form || props.covered) return null
  const specific = WebSearch.providerField(form) !== undefined
  const selection = Requests.webSearchSelection(choice, owner, form, request)
  const submit = (answer: string | false) => {
    if (request.sending || !connected || (answer === false && specific)) return
    const started = { form, owner, connection: props.connection, title: props.title }
    setSending(started)
    setChoice({ owner, formID: form.id, value: selection.value, failed: false })
    void reply(form, answer)
      .then(props.onAnswered, () =>
        setChoice((current) => current && (current.owner === owner ? { ...current, failed: true } : current)),
      )
      .finally(() => setSending((current) => (current === started ? undefined : current)))
  }
  const dock = {
    form,
    value: selection.value,
    failed: selection.failed,
    pending: request.sending,
    disabled: !connected,
    onValueChange: (next: string) => setChoice({ owner, formID: form.id, value: next, failed: false }),
    onSubmit: submit,
  }
  return (
    <Source
      title={sending && request.sending ? sending.title : props.title}
      sessionID={Session.ID.make(form.sessionID)}
      viewed={props.sessionID}
      onOpen={props.onOpen}
    >
      {specific ? <ProviderDock {...dock} /> : <ConsentDock {...dock} root={props.root} />}
    </Source>
  )
}

function PermissionRequest(props: {
  request: Permission.Request
  pending: boolean
  onReply: (reply: Permission.Reply, message?: string) => void
}) {
  const request = props.request
  const [instead, setInstead] = useState("")
  const typed = instead.trim()
  return (
    <Item variant="outline" className="bg-card shadow-composer">
      <ItemMedia variant="icon">
        <IconShieldQuestion />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Allow {request.action}?</ItemTitle>
        {request.resources.length > 0 ? (
          <ItemDescription className="font-mono text-xs break-all whitespace-pre-wrap">
            {request.resources.join("\n")}
          </ItemDescription>
        ) : null}
        {request.message ? <ItemDescription>{request.message}</ItemDescription> : null}
      </ItemContent>
      <ItemActions>
        <Button
          size="sm"
          variant="outline"
          disabled={props.pending}
          onClick={() => (typed ? props.onReply("reject", typed) : props.onReply("reject"))}
        >
          Deny
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={props.pending || typed !== ""}
          title={request.save && request.save.length > 0 ? request.save.join(", ") : undefined}
          onClick={() => props.onReply("always")}
        >
          Allow always
        </Button>
        <Button size="sm" disabled={props.pending || typed !== ""} onClick={() => props.onReply("once")}>
          {props.pending ? <Spinner data-icon="inline-start" /> : null}
          Allow once
        </Button>
      </ItemActions>
      <ItemFooter>
        <InputGroup>
          <InputGroupInput
            value={instead}
            aria-label="Deny and tell Ren what to do instead"
            placeholder="Deny and tell Ren what to do instead…"
            disabled={props.pending}
            onChange={(event) => setInstead(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing || !typed) return
              event.preventDefault()
              props.onReply("reject", typed)
            }}
          />
        </InputGroup>
      </ItemFooter>
    </Item>
  )
}

function QuestionForm(props: {
  form: Form.Info
  expired: boolean
  pending: boolean
  onSubmit: (answer: Form.Answer) => void
  onDismiss: () => void
}) {
  const questions = props.form.fields.filter(Requests.isQuestion)
  const [progress, setProgress] = useState(() => FormProgress.read(props.form.id) ?? FormProgress.empty)
  const update = (next: FormProgress.Progress) => {
    setProgress(next)
    FormProgress.write(props.form.id, next)
  }
  const first = questions.at(0)?.key
  return (
    <Card size="sm" className="shadow-composer">
      <CardHeader>
        <CardTitle>{questions.length > 1 ? "Ren has a few questions" : "Ren has a question"}</CardTitle>
        {props.expired ? (
          <CardDescription>This question expired. Your answer goes to the chat as a new message.</CardDescription>
        ) : null}
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            className="text-muted-foreground"
            disabled={props.pending}
            onClick={props.onDismiss}
          >
            <IconX />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Questionnaire
          items={questions.map((field) => ({
            name: field.key,
            required: field.required === true,
            choices: (field.options ?? []).map((option) => ({ value: option.value })),
          }))}
          item={progress.item ?? first ?? ""}
          onItemChange={(item) => update({ ...progress, item })}
          shortcuts="letters"
          onSubmit={(event) => {
            event.preventDefault()
            props.onSubmit(Requests.readFormAnswer(props.form, new FormData(event.currentTarget)))
          }}
        >
          {questions.length > 1 ? <QuestionnaireProgress /> : null}
          {questions.map((field) => {
            const chosen = progress.answers[field.key] ?? []
            const multiple = field.type === "multiselect"
            return (
              <QuestionnaireItem
                key={field.key}
                name={field.key}
                required={field.required === true}
                multiple={multiple}
              >
                <QuestionnaireTitle>{field.description ?? field.title ?? props.form.title}</QuestionnaireTitle>
                {multiple ? <QuestionnaireDescription>Select all that apply.</QuestionnaireDescription> : null}
                <QuestionnaireChoices>
                  {(field.options ?? []).map((option) => (
                    <QuestionnaireChoice
                      key={option.value}
                      value={option.value}
                      disabled={props.pending}
                      checked={chosen.includes(option.value)}
                      onChange={(event) => {
                        const rest = multiple ? chosen.filter((value) => value !== option.value) : []
                        const next = event.currentTarget.checked ? [...rest, option.value] : rest
                        update({ ...progress, answers: { ...progress.answers, [field.key]: next } })
                      }}
                    >
                      <span className="font-medium">{option.label}</span>
                      {option.description ? (
                        <QuestionnaireChoiceDescription>{option.description}</QuestionnaireChoiceDescription>
                      ) : null}
                    </QuestionnaireChoice>
                  ))}
                  {field.custom === false && (field.options ?? []).length > 0 ? null : (
                    <QuestionnaireInput
                      aria-label="Type your own answer"
                      placeholder="Something else…"
                      disabled={props.pending}
                      value={progress.custom[field.key] ?? ""}
                      onChange={(event) =>
                        update({ ...progress, custom: { ...progress.custom, [field.key]: event.currentTarget.value } })
                      }
                    />
                  )}
                </QuestionnaireChoices>
                <QuestionnaireError />
              </QuestionnaireItem>
            )
          })}
          <QuestionnaireActions>
            <QuestionnairePrevious size="sm" />
            <QuestionnaireSkip size="sm" />
            <QuestionnaireNext size="sm" />
            <QuestionnaireSubmit size="sm" disabled={props.pending}>
              {props.pending ? <Spinner data-icon="inline-start" /> : null}
              Send
            </QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>
      </CardContent>
    </Card>
  )
}

export function SessionRequests(props: {
  root: Session.ID
  sessionID: Session.ID
  permission: Permission.Request | undefined
  permissionTitle: string
  form: Form.Info | undefined
  formTitle: string
  formExpired: boolean
  connection: number
  onOpen: (sessionID: Session.ID) => void
}) {
  const [sending, setSending] = useState<string>()
  const scroller = useMessageScroller()
  const approving = Chat.useAutoApprove(props.root).enabled
  const permission = approving ? undefined : props.permission
  const form = props.form?.kind === "question" ? props.form : undefined
  const replyPermission = ChatReact.useAction(props.root, (opened, reply: Parameters<typeof opened.replyPermission>) =>
    opened.replyPermission(...reply),
  )
  const replyForm = ChatReact.useAction(props.root, (opened, reply: Parameters<typeof opened.replyForm>) =>
    opened.replyForm(...reply),
  )
  const cancelForm = ChatReact.useAction(props.root, (opened, cancel: Parameters<typeof opened.cancelForm>) =>
    opened.cancelForm(...cancel),
  )
  const answered = () => scroller.scrollToEnd({ behavior: "smooth" })
  const settle = (id: string, request: () => Promise<unknown>, title: string) => {
    if (sending === id) return
    setSending(id)
    void request()
      .then(answered, Failure.notify(title))
      .finally(() => setSending((current) => (current === id ? undefined : current)))
  }
  const webSearch = (
    <SessionWebSearch
      root={props.root}
      sessionID={props.sessionID}
      form={props.form?.kind === "websearch.provider" ? props.form : undefined}
      title={props.formTitle}
      connection={props.connection}
      covered={permission !== undefined}
      onOpen={props.onOpen}
      onAnswered={answered}
    />
  )
  if (permission)
    return (
      <>
        {webSearch}
        <Source
          title={props.permissionTitle}
          sessionID={Session.ID.make(permission.sessionID)}
          viewed={props.sessionID}
          onOpen={props.onOpen}
        >
          <PermissionRequest
            key={permission.id}
            request={permission}
            pending={sending === permission.id}
            onReply={(reply, message) =>
              settle(
                permission.id,
                () => replyPermission([permission.sessionID, permission.id, reply, message]),
                "Could not answer the permission request",
              )
            }
          />
        </Source>
      </>
    )
  if (!form) return webSearch
  const owner = Session.ID.make(form.sessionID)
  return (
    <>
      {webSearch}
      <Source title={props.formTitle} sessionID={owner} viewed={props.sessionID} onOpen={props.onOpen}>
        <QuestionForm
          key={form.id}
          form={form}
          expired={props.formExpired}
          pending={sending === form.id}
          onDismiss={() =>
            settle(
              form.id,
              () => cancelForm([owner, form.id]).then(() => FormProgress.clear(form.id)),
              "Could not dismiss the question",
            )
          }
          onSubmit={(answer) =>
            settle(
              form.id,
              () => replyForm([owner, form.id, answer]).then(() => FormProgress.clear(form.id)),
              "Could not send your answer",
            )
          }
        />
      </Source>
    </>
  )
}
