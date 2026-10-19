import { type ChatState, Family, WebSearch } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Form } from "@ren/schema/form"
import { Session } from "@ren/schema/session"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { Questionnaire } from "@ren/ui/questionnaire"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { WebSearchConsent, type WebSearchProvider, type WebSearchProviders } from "@ren/ui/web-search-consent"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import type { ReactNode } from "react"
import { Chat } from "../../lib/chat.js"
import { FormProgress } from "./form-progress.js"
import { Requests } from "./requests.js"
import { SessionTitle } from "./session-title.js"

const failed = (title: string) => (error: unknown) =>
  Toast.manager.add({ type: "error", title, description: error instanceof Error ? error.message : String(error) })

function Source(props: {
  state: ChatState.State
  sessionID: Session.ID
  viewed: Session.ID
  onOpen: (sessionID: Session.ID) => void
  children: ReactNode
}) {
  if (props.sessionID === props.viewed) return props.children
  const title = SessionTitle.display(Family.childTitle(props.state, props.sessionID, ""), "Subagent")
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 px-1">
        <Icon glyph="Ghost" tone="secondary" />
        <Text purpose="caption" element="span" truncation="single-line">
          {title} needs your input
        </Text>
        <div className="ml-auto">
          <Button appearance="plain" size="small" onClick={() => props.onOpen(props.sessionID)}>
            Open subagent
          </Button>
        </div>
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
  state: ChatState.State
  covered: boolean
  onOpen: (sessionID: Session.ID) => void
  onAnswered: () => void
}) {
  const [choice, setChoice] = useState<Requests.WebSearchChoice>()
  const [sending, setSending] = useState<Requests.WebSearchSending>()
  const status = ChatReact.useStatus(props.root)
  const connected = AsyncResult.isSuccess(status) && status.value === "connected"
  const reply = ChatReact.useAction(props.root, (opened, form: Form.Info, selection: string | false) =>
    opened.replyWebSearch(form, selection),
  )
  const owner = props.sessionID
  const request = Requests.webSearchRequest(
    sending,
    Family.webSearch(props.state, props.sessionID),
    owner,
    props.state.connection,
  )
  const form = request.form
  if (!form || props.covered) return null
  const specific = WebSearch.providerField(form) !== undefined
  const selection = Requests.webSearchSelection(choice, owner, form, request.sending)
  const submit = (answer: string | false) => {
    if (request.sending || !connected || (answer === false && specific)) return
    const started = { form, owner, connection: props.state.connection }
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
      state={props.state}
      sessionID={Session.ID.make(form.sessionID)}
      viewed={props.sessionID}
      onOpen={props.onOpen}
    >
      {specific ? <ProviderDock {...dock} /> : <ConsentDock {...dock} root={props.root} />}
    </Source>
  )
}

export function SessionRequests(props: {
  root: Session.ID
  sessionID: Session.ID
  state: ChatState.State
  onOpen: (sessionID: Session.ID) => void
  onAnswered: () => void
}) {
  const [sending, setSending] = useState<string>()
  const approving = Chat.useAutoApprove(props.root).enabled
  const permission = approving ? undefined : Family.permission(props.state, props.sessionID)
  const form = Family.question(props.state, props.sessionID)
  const replyPermission = ChatReact.useAction(props.root, (opened, reply: Parameters<typeof opened.replyPermission>) =>
    opened.replyPermission(...reply),
  )
  const replyForm = ChatReact.useAction(props.root, (opened, reply: Parameters<typeof opened.replyForm>) =>
    opened.replyForm(...reply),
  )
  const cancelForm = ChatReact.useAction(props.root, (opened, cancel: Parameters<typeof opened.cancelForm>) =>
    opened.cancelForm(...cancel),
  )
  const settle = (id: string, request: () => Promise<unknown>, title: string) => {
    if (sending === id) return
    setSending(id)
    void request()
      .then(props.onAnswered, failed(title))
      .finally(() => setSending((current) => (current === id ? undefined : current)))
  }
  const webSearch = (
    <SessionWebSearch
      root={props.root}
      sessionID={props.sessionID}
      state={props.state}
      covered={permission !== undefined}
      onOpen={props.onOpen}
      onAnswered={props.onAnswered}
    />
  )
  if (permission)
    return (
      <>
        {webSearch}
        <Source
          state={props.state}
          sessionID={Session.ID.make(permission.sessionID)}
          viewed={props.sessionID}
          onOpen={props.onOpen}
        >
          <Questionnaire
            resetKey={permission.id}
            questions={[Requests.permissionQuestion(permission)]}
            pending={sending === permission.id}
            submitLabel="Continue"
            onSubmit={(data) => {
              const reply = Requests.readPermissionReply(data)
              if (!reply) return
              settle(
                permission.id,
                () => replyPermission([permission.sessionID, permission.id, reply.reply, reply.message]),
                "Could not answer the permission request",
              )
            }}
          />
        </Source>
      </>
    )
  if (form)
    return (
      <>
        {webSearch}
        <Source
          state={props.state}
          sessionID={Session.ID.make(form.sessionID)}
          viewed={props.sessionID}
          onOpen={props.onOpen}
        >
          <Questionnaire
            resetKey={form.id}
            questions={Requests.formQuestions(form)}
            pending={sending === form.id}
            collapsible
            progress={FormProgress.read(form.id)}
            onProgressChange={(progress) => FormProgress.write(form.id, progress)}
            onDismiss={() =>
              settle(
                form.id,
                () => cancelForm([Session.ID.make(form.sessionID), form.id]),
                "Could not dismiss the question",
              )
            }
            leadingAction={
              <Button
                appearance="plain"
                size="small"
                disabled={sending === form.id}
                onClick={() =>
                  settle(
                    form.id,
                    () => cancelForm([Session.ID.make(form.sessionID), form.id]),
                    "Could not dismiss the question",
                  )
                }
              >
                Dismiss
              </Button>
            }
            onSubmit={(data) =>
              settle(
                form.id,
                () =>
                  replyForm([Session.ID.make(form.sessionID), form.id, Requests.readFormAnswer(form, data)]).then(() =>
                    FormProgress.clear(form.id),
                  ),
                "Could not send your answer",
              )
            }
          />
        </Source>
      </>
    )
  return webSearch
}
