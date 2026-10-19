import { ChatState, Composer, ComposerHistory } from "@ren/chat"
import type { ChatSession } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionInbox } from "@ren/schema/session-inbox"
import { SessionMessage } from "@ren/schema/session-message"
import { SessionModel } from "@ren/schema/session-model"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { ModelPicker } from "@ren/ui/model-picker"
import { Toast } from "@ren/ui/toast"
import { Effect, SubscriptionRef } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useRef, useState } from "react"
import type { ReactNode } from "react"
import { Keyboard } from "../../platform/keyboard.js"
import { Platform } from "../../platform/platform.js"
import { Viewport } from "../../platform/viewport.js"
import { ComposerKeys } from "./composer-keys.js"

const behavior = "steer"
const historyKey = "history"

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const known = (state: ChatState.State, sessionID: Session.ID, id: SessionMessage.ID) =>
  ChatState.messages(state, sessionID).some((item) => item.id === id) ||
  ChatState.pending(state, sessionID).some((item) => item.id === id)

function SessionModelPicker(props: {
  sessionID: Session.ID
  draft: Composer.Draft
  current: SessionModel.Ref | undefined
  disabled: boolean
  onChange: (model: SessionModel.Ref) => void
}) {
  const models = ChatReact.useModels(props.sessionID)
  const list = AsyncResult.isSuccess(models) ? models.value : []
  const selected = Composer.model(props.draft, props.current, list)
  return (
    <ModelPicker
      models={list.map((model) => ({
        value: SessionModel.key(model),
        label: model.name,
        group: model.providerID,
        variants: model.variants.map((variant) => ({ value: variant.id, label: capitalize(variant.id) })),
      }))}
      value={selected && { model: SessionModel.key(selected), ...(selected.variant && { variant: selected.variant }) }}
      loading={list.length === 0 && !AsyncResult.isFailure(models)}
      disabled={props.disabled}
      onValueChange={(value) => {
        const model = list.find((item) => SessionModel.key(item) === value.model)
        if (model)
          props.onChange({
            id: model.id,
            providerID: model.providerID,
            ...(value.variant && { variant: value.variant }),
          })
      }}
    />
  )
}

function QueuedMessages(props: { state: ChatState.State; sessionID: Session.ID }) {
  const queued = Composer.queued(ChatState.pending(props.state, props.sessionID))
  if (queued.length === 0) return null
  return (
    <ConversationShell.Queue label={`${queued.length} queued`} count={queued.length}>
      {queued.map((item) => (
        <ConversationShell.QueueItem
          key={item.id}
          text={item.text}
          {...(item.attachments > 0 && { detail: item.attachments === 1 ? "1 file" : `${item.attachments} files` })}
        />
      ))}
    </ConversationShell.Queue>
  )
}

function Controls(props: {
  running: boolean
  stoppable: boolean
  content: boolean
  unavailable: boolean
  alternate: SessionInbox.Delivery | undefined
  model: ReactNode
  onStop: () => void
  onAlternate: () => void
}) {
  const alternate = props.content && !props.unavailable ? props.alternate : undefined
  return (
    <>
      {props.model}
      {alternate ? (
        <ConversationShell.ComposerAlternate
          label={alternate === "queue" ? "Queue" : "Steer"}
          shortcut={Viewport.shortcut("↵")}
          {...(alternate === "steer" && { description: "Send to the running turn" })}
          onActivate={props.onAlternate}
        />
      ) : null}
      <ConversationShell.ComposerSubmit
        running={props.stoppable}
        content={props.content}
        disabled={!props.content || props.unavailable}
        onStop={props.onStop}
      />
    </>
  )
}

export function SessionComposer(props: { sessionID: Session.ID; state: ChatState.State; unavailable: boolean }) {
  const platform = Platform.usePlatform()
  const mobile = Viewport.useMobile()
  const key = `session.${props.sessionID}`
  const [draft, setDraft] = useState(() => Composer.decode(platform.drafts?.get(key)))
  const [history, setHistory] = useState(() => ComposerHistory.decode(platform.drafts?.get(historyKey)))
  const [browsing, setBrowsing] = useState(ComposerHistory.idle)
  const input = useRef<HTMLTextAreaElement>(null)
  const prompt = ChatReact.useAction(props.sessionID, (opened, request: ChatSession.PromptInput) =>
    opened.prompt(request).pipe(
      Effect.retry({ times: 1 }),
      Effect.catch((error) =>
        Effect.flatMap(SubscriptionRef.get(opened.state), (current) =>
          request.id && known(current, props.sessionID, request.id) ? Effect.void : Effect.fail(error),
        ),
      ),
    ),
  )
  const interrupt = ChatReact.useAction(props.sessionID, (opened) => opened.interrupt)
  const info = props.state.info[props.sessionID]
  const running = ChatState.activity(props.state, props.sessionID) === "running"
  const stoppable = running && info?.capabilities.interrupt !== false
  const content = !Composer.isBlank(draft)

  const store = (next: Composer.Draft) => {
    const encoded = Composer.encode(next)
    if (encoded) platform.drafts?.set(key, encoded)
    else platform.drafts?.remove(key)
  }
  const change = (next: Composer.Draft) => {
    setDraft(next)
    store(next)
  }
  const remember = (next: ReadonlyArray<ComposerHistory.Entry>) => {
    setHistory(next)
    platform.drafts?.set(historyKey, ComposerHistory.encode(next))
  }
  const caret = (position: number) =>
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(position, position)
    })
  const stop = () =>
    void interrupt().catch((error: unknown) =>
      Toast.manager.add({ type: "error", title: "Could not stop Ren", description: describe(error) }),
    )
  const submit = (alternative: boolean) => {
    if (props.unavailable) return
    const submission = Composer.submission(draft, {
      working: running,
      behavior,
      alternative,
      queue: info?.capabilities.queue !== false,
      current: info?.model,
    })
    if (!submission) {
      if (stoppable) stop()
      return
    }
    const id = submission.retry ?? SessionMessage.ID.create()
    const entries = ComposerHistory.prepend(history, submission.sent)
    remember(entries)
    setBrowsing(ComposerHistory.idle)
    change(submission.next)
    if (mobile) input.current?.blur()
    void prompt({
      text: submission.text,
      delivery: submission.delivery,
      id,
      ...(submission.model && { model: submission.model }),
    }).catch((error: unknown) => {
      remember(ComposerHistory.remove(entries, submission.sent))
      setDraft((current) => {
        const next = Composer.restore(current, submission.sent, id)
        store(next)
        return next
      })
      Toast.manager.add({
        type: "error",
        title: "Could not send your message",
        description: `${describe(error)} Your draft has been kept.`,
      })
    })
  }
  const browse = (node: HTMLTextAreaElement, direction: "up" | "down") => {
    if (node.selectionStart !== node.selectionEnd) return false
    const moved = ComposerHistory.navigate(browsing, direction, history, draft, node.selectionStart)
    if (!moved) return false
    setBrowsing(moved.browsing)
    change(Composer.fromHistory(draft, moved.entry))
    caret(moved.cursor === "start" ? 0 : moved.entry.text.length)
    return true
  }

  Keyboard.useKeyDown((event) => {
    if (event.defaultPrevented || !Keyboard.fromPage(event)) return
    if (ComposerKeys.intent(event, running) === "stop") {
      event.preventDefault()
      stop()
      return
    }
    if (Keyboard.isPrintable(event) && !props.unavailable) input.current?.focus()
  })

  const controls = (
    <Controls
      running={running}
      stoppable={stoppable}
      content={content}
      unavailable={props.unavailable}
      alternate={info?.capabilities.queue === false ? undefined : Composer.alternate(running, behavior)}
      model={
        info?.capabilities.model === false ? null : (
          <SessionModelPicker
            sessionID={props.sessionID}
            draft={draft}
            current={info?.model}
            disabled={props.unavailable}
            onChange={(model) => {
              change(Composer.withModel(draft, model))
              requestAnimationFrame(() => input.current?.focus())
            }}
          />
        )
      }
      onStop={stop}
      onAlternate={() => submit(true)}
    />
  )

  return (
    <ConversationShell.Composer
      label="Message Ren"
      layout="adaptive"
      onSubmit={() => submit(false)}
      queue={<QueuedMessages state={props.state} sessionID={props.sessionID} />}
      attachments={
        draft.pasted.length > 0
          ? draft.pasted.map((block) => (
              <ConversationShell.PastedText
                key={block.id}
                text={block.text}
                disabled={props.unavailable}
                onRemove={() => change(Composer.removePasted(draft, block.id))}
                onShowInTextField={() => {
                  const shown = Composer.showPasted(draft, block.id, input.current?.selectionStart ?? draft.text.length)
                  change(shown.draft)
                  caret(shown.cursor)
                }}
              />
            ))
          : undefined
      }
      trailing={controls}
      footerTrailing={controls}
    >
      <ConversationShell.ComposerInput
        ref={input}
        aria-label="Message"
        dir="auto"
        autoComplete="off"
        focusOnMount={!mobile}
        placeholder={running ? "Also list who reviewed each one" : "Summarise the open pull requests"}
        readOnly={props.unavailable}
        value={draft.text}
        onChange={(event) => {
          setBrowsing(ComposerHistory.idle)
          change(Composer.withText(draft, event.currentTarget.value))
        }}
        onPaste={(event) => {
          const data = event.clipboardData
          const text = data.getData("text/plain")
          const kind = Composer.paste(
            { types: [...data.types], kinds: [...data.items].map((item) => item.kind), text },
            platform.readClipboardImage !== undefined,
          )
          if (kind === "text") return
          event.preventDefault()
          if (kind === "attachment") Toast.manager.add({ title: "Files can’t be attached yet" })
          else change(Composer.addPasted(draft, { id: SessionMessage.ID.create(), text }))
        }}
        onKeyDown={(event) => {
          const intent = ComposerKeys.intent(
            {
              key: event.key,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              altKey: event.altKey,
              repeat: event.repeat,
              isComposing: event.nativeEvent.isComposing,
            },
            stoppable,
          )
          if (intent === "up" || intent === "down") {
            if (browse(event.currentTarget, intent)) event.preventDefault()
            return
          }
          if (intent === undefined) return
          event.preventDefault()
          if (intent === "alternate") submit(true)
          if (intent === "stop") stop()
        }}
      />
    </ConversationShell.Composer>
  )
}
