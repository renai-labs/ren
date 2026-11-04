import { useState, type ReactNode } from "react"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import { IconGhostFilled, IconShieldQuestion, IconWorld, IconX } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@ren/ui/card"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@ren/ui/item"
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
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import { errorMessage } from "../../lib/errors.js"

type QuestionField = Form.StringField | Form.MultiselectField

const isQuestion = (field: Form.Field): field is QuestionField =>
  field.type === "string" || field.type === "multiselect"

function readAnswer(form: Form.Info, data: FormData): Form.Answer {
  return Object.fromEntries(
    form.fields.filter(isQuestion).flatMap((field) => {
      const values = data
        .getAll(field.key)
        .flatMap((value) => (typeof value === "string" && value.trim() ? [value.trim()] : []))
      if (values.length === 0) return []
      return [[field.key, field.type === "multiselect" ? values : (values.at(0) ?? "")]]
    }),
  )
}

function Source(props: {
  title: string
  sessionID: string
  viewed: string
  onOpen: (id: Session.ID) => void
  children: ReactNode
}) {
  if (props.sessionID === props.viewed) return props.children
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground">
        <IconGhostFilled className="size-4" />
        <span className="truncate">{props.title} needs your input</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => props.onOpen(Session.ID.make(props.sessionID))}
        >
          Open subagent
        </Button>
      </div>
      {props.children}
    </div>
  )
}

function PermissionRequest(props: {
  request: Permission.Request
  pending: boolean
  onReply: (reply: Permission.Reply) => void
}) {
  const request = props.request
  return (
    <section
      aria-label="Permission request"
      className="flex animate-in flex-col gap-3 rounded-xl border bg-card p-4 duration-200 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:slide-in-from-bottom-0"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-chart-3">
          <IconShieldQuestion className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">Allow Ren to {request.action}?</span>
          <span className="text-sm text-muted-foreground">
            {request.message ?? "Ren asks before it does this. You can allow it once or every time."}
          </span>
        </div>
      </div>
      {request.resources.length > 0 ? (
        <CodeBlock size="sm" className="ml-11 w-auto">
          <CodeBlockContent wrap className="max-h-32">
            {request.resources.join("\n")}
          </CodeBlockContent>
        </CodeBlock>
      ) : null}
      <div className="ml-11 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={props.pending} onClick={() => props.onReply("once")}>
          {props.pending ? <Spinner data-icon="inline-start" /> : null}
          Allow once
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={props.pending}
          title={request.save && request.save.length > 0 ? request.save.join(", ") : undefined}
          onClick={() => props.onReply("always")}
        >
          Always allow
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={props.pending}
          onClick={() => props.onReply("reject")}
        >
          Deny
        </Button>
      </div>
    </section>
  )
}

function QuestionForm(props: {
  form: Form.Info
  expired: boolean
  pending: boolean
  onSubmit: (answer: Form.Answer) => void
  onDismiss: () => void
}) {
  const questions = props.form.fields.filter(isQuestion)
  return (
    <Card size="sm">
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
            disabled={props.pending}
            onClick={props.onDismiss}
          >
            <IconX />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Questionnaire
          key={props.form.id}
          items={questions.map((field) => ({
            name: field.key,
            required: field.required === true,
            choices: (field.options ?? []).map((option) => ({ value: option.value })),
          }))}
          shortcuts="letters"
          ref={(node) => {
            if (node && document.activeElement === document.body)
              node.querySelector<HTMLElement>("fieldset:not([hidden])")?.focus({ preventScroll: true })
          }}
          onSubmit={(event) => {
            event.preventDefault()
            props.onSubmit(readAnswer(props.form, new FormData(event.currentTarget)))
          }}
        >
          {questions.length > 1 ? <QuestionnaireProgress /> : null}
          {questions.map((field) => (
            <QuestionnaireItem
              key={field.key}
              name={field.key}
              required={field.required === true}
              multiple={field.type === "multiselect"}
            >
              <QuestionnaireTitle>{field.description ?? field.title ?? props.form.title}</QuestionnaireTitle>
              {field.type === "multiselect" ? (
                <QuestionnaireDescription>Select all that apply.</QuestionnaireDescription>
              ) : null}
              <QuestionnaireChoices>
                {(field.options ?? []).map((option) => (
                  <QuestionnaireChoice key={option.value} value={option.value}>
                    <span className="font-medium">{option.label}</span>
                    {option.description ? (
                      <QuestionnaireChoiceDescription>{option.description}</QuestionnaireChoiceDescription>
                    ) : null}
                  </QuestionnaireChoice>
                ))}
                {field.custom === false && (field.options ?? []).length > 0 ? null : (
                  <QuestionnaireInput aria-label="Type your own answer" placeholder="Something else…" />
                )}
              </QuestionnaireChoices>
              <QuestionnaireError />
            </QuestionnaireItem>
          ))}
          <QuestionnaireActions>
            <QuestionnairePrevious />
            <QuestionnaireSkip />
            <QuestionnaireNext />
            <QuestionnaireSubmit disabled={props.pending}>Send</QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>
      </CardContent>
    </Card>
  )
}

function WebSearchConsent(props: { pending: boolean; onAnswer: (selection: string | false) => void }) {
  return (
    <Item variant="outline" className="bg-card">
      <ItemMedia variant="icon">
        <IconWorld />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Allow web search?</ItemTitle>
        <ItemDescription>Ren wants to search the web for this chat.</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline" disabled={props.pending} onClick={() => props.onAnswer(false)}>
          Not now
        </Button>
        <Button size="sm" disabled={props.pending} onClick={() => props.onAnswer("random")}>
          {props.pending ? <Spinner data-icon="inline-start" /> : null}
          Enable
        </Button>
      </ItemActions>
    </Item>
  )
}

export function ChatRequests(props: {
  root: Session.ID
  sessionID: Session.ID
  permission: Permission.Request | undefined
  permissionTitle: string
  form: Form.Info | undefined
  formTitle: string
  formExpired: boolean
  onOpen: (id: Session.ID) => void
}) {
  const [sending, setSending] = useState<string>()
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
  const settle = (id: string, request: () => Promise<unknown>, title: string) => {
    if (sending === id) return
    setSending(id)
    void request()
      .catch((error: unknown) => toast.error(title, { description: errorMessage(error) }))
      .finally(() => setSending((current) => (current === id ? undefined : current)))
  }
  const permission = props.permission
  if (permission)
    return (
      <Source
        title={props.permissionTitle}
        sessionID={permission.sessionID}
        viewed={props.sessionID}
        onOpen={props.onOpen}
      >
        <PermissionRequest
          request={permission}
          pending={sending === permission.id}
          onReply={(reply) =>
            settle(
              permission.id,
              () => replyPermission([permission.sessionID, permission.id, reply]),
              "Could not answer the permission request",
            )
          }
        />
      </Source>
    )
  const form = props.form
  if (!form) return null
  const owner = Session.ID.make(form.sessionID)
  if (form.kind === "websearch.provider")
    return (
      <Source title={props.formTitle} sessionID={form.sessionID} viewed={props.sessionID} onOpen={props.onOpen}>
        <WebSearchConsent
          pending={sending === form.id}
          onAnswer={(selection) =>
            settle(form.id, () => replyWebSearch(form, selection), "Could not answer the web search request")
          }
        />
      </Source>
    )
  return (
    <Source title={props.formTitle} sessionID={form.sessionID} viewed={props.sessionID} onOpen={props.onOpen}>
      <QuestionForm
        form={form}
        expired={props.formExpired}
        pending={sending === form.id}
        onSubmit={(answer) => settle(form.id, () => replyForm([owner, form.id, answer]), "Could not send your answer")}
        onDismiss={() => settle(form.id, () => cancelForm([owner, form.id]), "Could not dismiss the question")}
      />
    </Source>
  )
}
