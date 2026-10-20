import { ChatState, ClientCommand, Composer, ComposerHistory, Mentions } from "@ren/chat"
import type { ChatSession } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionInbox } from "@ren/schema/session/inbox"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Toast } from "@ren/ui/toast"
import { Effect, Predicate, SubscriptionRef } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useRef, useState } from "react"
import type { KeyboardEvent, ReactNode } from "react"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Debounce } from "../../lib/debounce.js"
import { DraftStore } from "../../platform/draft-store.js"
import { Keyboard } from "../../platform/keyboard.js"
import { Platform } from "../../platform/platform.js"
import { Viewport } from "../../platform/viewport.js"
import { Failure } from "./failure.js"
import { ComposerAddMenu } from "./composer-add-menu.js"
import { ComposerKeys } from "./composer-keys.js"
import { ComposerModelPicker } from "./composer-model-picker.js"
import { ComposerQueue } from "./composer-queue.js"
import { SessionDrafts } from "./session-drafts.js"

const historyKey = "history"
const trailingSpace = /\s$/
const fileSearchDelay = 150

const known = (state: ChatState.State, sessionID: Session.ID, id: SessionMessage.ID) =>
  ChatState.messages(state, sessionID).some((item) => item.id === id) ||
  ChatState.pending(state, sessionID).some((item) => item.id === id)

const listed = <A,>(result: AsyncResult.AsyncResult<ReadonlyArray<A>, unknown>) =>
  AsyncResult.isSuccess(result) ? result.value : []

const press = (event: KeyboardEvent<HTMLTextAreaElement>): ComposerKeys.Press => ({
  key: event.key,
  metaKey: event.metaKey,
  ctrlKey: event.ctrlKey,
  shiftKey: event.shiftKey,
  altKey: event.altKey,
  repeat: event.repeat,
  isComposing: event.nativeEvent.isComposing,
})

const clientCommands = (state: ChatState.State, sessionID: Session.ID) => {
  const capabilities = state.info[sessionID]?.capabilities
  const prompted = ChatState.visibleUserMessages(state, sessionID).length > 0
  return ClientCommand.offered({
    "model.choose": capabilities?.model !== false,
    "session.compact": capabilities?.compact !== false && prompted,
    "session.undo": capabilities?.revert !== false && prompted,
    "session.redo": capabilities?.revert !== false && ChatState.revertMessageID(state, sessionID) !== undefined,
  })
}

const sessionStatus = (state: ChatState.State, sessionID: Session.ID) => {
  const info = state.info[sessionID]
  const running = ChatState.activity(state, sessionID) === "running"
  return {
    model: info?.model,
    running,
    stoppable: running && info?.capabilities.interrupt !== false,
    queue: info?.capabilities.queue !== false,
    commands: info?.capabilities.commands !== false,
    picker: info?.capabilities.model !== false,
  }
}

const commandSuggestions = (
  commands: ReadonlyArray<ClientCommand.Suggestion>,
): ReadonlyArray<ConversationShell.Suggestion> =>
  commands.map((item) => ({
    value: item.value,
    kind: "command",
    label: `/${item.trigger}`,
    description: item.description,
  }))

const mentionSuggestions = (items: ReadonlyArray<Mentions.Item>): ReadonlyArray<ConversationShell.Suggestion> =>
  items.map((item) => ({
    value: Mentions.key(item),
    kind: item.kind,
    label: item.label,
    description: item.description,
  }))

const commandQuery = (trigger: Composer.Trigger | undefined) => (trigger?.kind === "command" ? trigger.query : "")

interface Suggesting {
  readonly trigger: Composer.Trigger
  readonly active?: string
}

function useMentionCatalog(sessionID: Session.ID, query: string) {
  const searched = Debounce.useDebouncedValue(query, fileSearchDelay)
  const found = listed(ChatReact.useFiles({ root: sessionID, query: searched, type: "file" }))
  return {
    agents: SessionCatalog.mentionable(listed(ChatReact.useAgents(sessionID))).map(Mentions.fromAgent),
    skills: Composer.offeredSkills(listed(ChatReact.useSkills(sessionID))).map(Mentions.fromSkill),
    files: searched && query ? found.map(Mentions.fromFile) : [],
  }
}

function useSuggestions(input: {
  sessionID: Session.ID
  commands: boolean
  client: ReadonlyArray<ClientCommand.Command>
  suggesting: Suggesting | undefined
  picked: ReadonlyArray<Mentions.Item>
}) {
  const trigger = input.suggesting?.trigger
  const query = trigger?.kind === "mention" ? trigger.query : undefined
  const catalog = useMentionCatalog(input.sessionID, query ?? "")
  const listedCommands = Composer.offeredCommands(listed(ChatReact.useCommands(input.sessionID)))
  const commands = input.commands ? listedCommands : []
  const runnable = ClientCommand.suggestions(input.client, commands, commandQuery(trigger))
  const mentionable = query === undefined ? [] : Mentions.suggest({ ...catalog, query })
  const suggestions = trigger?.kind === "command" ? commandSuggestions(runnable) : mentionSuggestions(mentionable)
  const ids = suggestions.map((item) => item.value)
  return {
    trigger,
    label: trigger?.kind === "command" ? "Commands" : "Mentions",
    commands,
    runnable,
    mentionable,
    suggestions,
    ids,
    active: Composer.activeSuggestion(ids, input.suggesting?.active),
    catalog: [...catalog.agents, ...catalog.skills, ...input.picked],
  }
}

function SessionModelPicker(props: {
  sessionID: Session.ID
  draft: Composer.Draft
  current: SessionModel.Ref | undefined
  disabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (model: SessionModel.Ref) => void
}) {
  const models = ChatReact.useModels(props.sessionID)
  const list = AsyncResult.isSuccess(models) ? models.value : []
  return (
    <ComposerModelPicker
      models={list}
      selected={Composer.model(props.draft, props.current, list)}
      loading={list.length === 0 && !AsyncResult.isFailure(models)}
      disabled={props.disabled}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onChange={props.onChange}
    />
  )
}

function PastedBlocks(props: {
  pasted: Composer.Draft["pasted"]
  disabled: boolean
  onRemove: (id: string) => void
  onShow: (id: string) => void
}) {
  return props.pasted.map((block) => (
    <ConversationShell.PastedText
      key={block.id}
      text={block.text}
      disabled={props.disabled}
      onRemove={() => props.onRemove(block.id)}
      onShowInTextField={() => props.onShow(block.id)}
    />
  ))
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

export function SessionComposer(props: {
  sessionID: Session.ID
  state: ChatState.State
  unavailable: boolean
  covered: boolean
  onUndo: () => void
  onRedo: () => void
  onCompact: () => void
}) {
  const platform = Platform.usePlatform()
  const mobile = Viewport.useMobile()
  const key = SessionDrafts.key(props.sessionID)
  const behavior = ChatPreferences.followUp.read(platform.storage)
  const [draft, setDraft] = useState(() => Composer.decode(platform.drafts?.get(key)))
  const [history, setHistory] = useState(() => ComposerHistory.decode(platform.drafts?.get(historyKey)))
  const [browsing, setBrowsing] = useState(ComposerHistory.idle)
  const [suggesting, setSuggesting] = useState<Suggesting>()
  const [picked, setPicked] = useState<ReadonlyArray<Mentions.Item>>([])
  const [moving, setMoving] = useState(false)
  const [picking, setPicking] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const latest = useRef({ draft, history })
  DraftStore.useElsewhere({
    drafts: platform.drafts,
    key,
    editor: input,
    onChange: (value) => {
      latest.current.draft = Composer.decode(value)
      setDraft(latest.current.draft)
    },
  })
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
  const command = ChatReact.useAction(props.sessionID, (opened, request: ChatSession.CommandInput) =>
    opened.command(request),
  )
  const cancelInput = ChatReact.useAction(props.sessionID, (opened, id: SessionMessage.ID) => opened.cancelInput(id))
  const interrupt = ChatReact.useAction(props.sessionID, (opened) => opened.interrupt)
  const status = sessionStatus(props.state, props.sessionID)
  const running = status.running
  const stoppable = status.stoppable
  const content = !Composer.isBlank(draft)
  const queued = Composer.queued(ChatState.pending(props.state, props.sessionID))
  const readOnly = props.unavailable || moving
  const suggested = useSuggestions({
    sessionID: props.sessionID,
    commands: status.commands,
    client: clientCommands(props.state, props.sessionID),
    suggesting,
    picked,
  })
  const tokens = Mentions.tokens(draft.text, suggested.catalog)
  const resolve = (text: string) => Mentions.resolve(text, Mentions.tokens(text, suggested.catalog))

  const change = (next: Composer.Draft) => {
    latest.current.draft = next
    setDraft(next)
    const encoded = Composer.encode(next)
    if (encoded) platform.drafts?.set(key, encoded)
    else platform.drafts?.remove(key)
  }
  const remember = (next: ReadonlyArray<ComposerHistory.Entry>) => {
    latest.current.history = next
    setHistory(next)
    platform.drafts?.set(historyKey, ComposerHistory.encode(next))
  }
  const caret = (position: number, text: string) =>
    requestAnimationFrame(() => {
      const node = input.current
      if (!node || node.value !== text) return
      node.focus()
      node.setSelectionRange(position, position)
    })
  const stop = () => void interrupt().catch(Failure.toast("Could not stop Ren"))
  const move = (item: Composer.Queued) => {
    if (moving) return
    setMoving(true)
    void cancelInput(item.id)
      .then(
        () => {
          change(Composer.append(latest.current.draft, item.text))
          requestAnimationFrame(() => {
            const node = input.current
            if (node) caret(node.value.length, node.value)
          })
        },
        (error: unknown) =>
          Toast.manager.add({
            type: "error",
            title: "Could not move the message to the text field",
            description: Predicate.isTagged(error, "ConflictError")
              ? "Ren has already started on it."
              : Failure.describe(error),
          }),
      )
      .finally(() => setMoving(false))
  }
  const submit = (alternative: boolean) => {
    if (readOnly) return
    const submission = Composer.submission(draft, {
      working: running,
      behavior,
      alternative,
      queue: status.queue,
      current: status.model,
    })
    if (!submission) {
      if (stoppable) stop()
      return
    }
    const id = submission.retry ?? SessionMessage.ID.create()
    const slash = Composer.slash(submission.text, suggested.commands)
    remember(ComposerHistory.prepend(history, submission.sent))
    setBrowsing(ComposerHistory.idle)
    setSuggesting(undefined)
    change(submission.next)
    if (mobile) input.current?.blur()
    const failure = (title: string) => (error: unknown) => {
      remember(ComposerHistory.remove(latest.current.history, submission.sent))
      change(Composer.restore(latest.current.draft, submission.sent, id))
      Toast.manager.add({ type: "error", title, description: `${Failure.describe(error)} Your draft has been kept.` })
    }
    const selection = { delivery: submission.delivery, ...(submission.model && { model: submission.model }) }
    if (slash)
      void command({ name: slash.name, ...resolve(slash.text), ...selection }).catch(
        failure("Could not run the command"),
      )
    else void prompt({ id, ...resolve(submission.text), ...selection }).catch(failure("Could not send your message"))
  }
  const browse = (node: HTMLTextAreaElement, direction: "up" | "down") => {
    if (node.selectionStart !== node.selectionEnd) return false
    const moved = ComposerHistory.navigate(browsing, direction, history, draft, node.selectionStart)
    if (!moved) return false
    setBrowsing(moved.browsing)
    change(Composer.fromHistory(draft, moved.entry))
    caret(moved.cursor === "start" ? 0 : moved.entry.text.length, moved.entry.text)
    return true
  }
  const retype = (text: string, cursor: number) => {
    const trigger = Composer.trigger(text, cursor)
    setBrowsing(ComposerHistory.idle)
    setSuggesting(trigger && { trigger })
    change(Composer.withText(draft, text))
  }
  const runClient = (id: ClientCommand.ID) => {
    const run: Readonly<Record<ClientCommand.ID, () => void>> = {
      "model.choose": () => setPicking(true),
      "session.compact": props.onCompact,
      "session.undo": props.onUndo,
      "session.redo": props.onRedo,
    }
    run[id]()
  }
  const addMenu = (
    <ComposerAddMenu
      disabled={readOnly}
      populated={content}
      commands={suggested.runnable}
      onCommands={() => {
        setSuggesting({ trigger: { kind: "command", query: "" } })
        change(Composer.withText(draft, "/"))
        caret(1, "/")
      }}
      onCommand={(found) => {
        if (found.client) return runClient(found.client)
        const text = `/${found.trigger} ${draft.text.trim()}`
        change(Composer.withText(draft, text))
        caret(text.length, text)
      }}
      onMention={() => {
        const cursor = input.current?.selectionStart ?? draft.text.length
        const before = draft.text.slice(0, cursor)
        const inserted = Composer.insert(draft.text, before === "" || trailingSpace.test(before) ? "@" : " @", cursor)
        retype(inserted.text, inserted.cursor)
        caret(inserted.cursor, inserted.text)
      }}
    />
  )
  const choose = (value: string) => {
    const trigger = suggested.trigger
    setSuggesting(undefined)
    setBrowsing(ComposerHistory.idle)
    if (trigger?.kind === "command") {
      const found = suggested.runnable.find((item) => item.value === value)
      if (found?.client) {
        change(Composer.withText(draft, ""))
        runClient(found.client)
        return
      }
      const text = `/${found?.trigger ?? value} `
      change(Composer.withText(draft, text))
      caret(text.length, text)
      return
    }
    const item = suggested.mentionable.find((entry) => Mentions.key(entry) === value)
    if (!item || !trigger) return
    const inserted = Mentions.insert(
      draft.text,
      item,
      trigger.start,
      input.current?.selectionStart ?? draft.text.length,
    )
    if (item.kind === "file") setPicked((current) => [...current, item])
    change(Composer.withText(draft, inserted.text))
    caret(inserted.cursor, inserted.text)
  }
  const pick = (pressed: ComposerKeys.Press) => {
    const key = suggested.ids.length > 0 ? Composer.suggestionKey(pressed, suggested.ids, suggested.active) : undefined
    if (key?.type === "close") setSuggesting(undefined)
    if (key?.type === "move") setSuggesting((current) => current && { ...current, active: key.active })
    if (key?.type === "select") choose(key.id)
    return key !== undefined
  }
  const unmention = (node: HTMLTextAreaElement, pressed: string) => {
    const removed = readOnly
      ? undefined
      : Mentions.remove(draft.text, tokens, {
          key: pressed,
          selectionStart: node.selectionStart,
          selectionEnd: node.selectionEnd,
        })
    if (!removed) return false
    retype(removed.text, removed.cursor)
    caret(removed.cursor, removed.text)
    return true
  }
  const act = (intent: ComposerKeys.Intent | undefined, node: HTMLTextAreaElement) => {
    if (intent === "model") return false
    if (intent === "up" || intent === "down") return browse(node, intent)
    const first = queued.at(0)
    if (intent === "edit" && first) move(first)
    if (intent === "alternate") submit(true)
    if (intent === "stop") stop()
    return intent !== undefined && (intent !== "edit" || first !== undefined)
  }

  Keyboard.useKeyDown((event) => {
    if (props.covered || event.defaultPrevented) return
    if (status.picker && !readOnly && ComposerKeys.intent(event, { running }) === "model") {
      event.preventDefault()
      setPicking(true)
      return
    }
    if (!Keyboard.fromPage(event)) return
    if (ComposerKeys.intent(event, { running: stoppable }) === "stop") {
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
      alternate={status.queue ? Composer.alternate(behavior, { working: running }) : undefined}
      model={
        status.picker ? (
          <SessionModelPicker
            sessionID={props.sessionID}
            draft={draft}
            current={status.model}
            disabled={props.unavailable}
            open={picking}
            onOpenChange={(open) => {
              setPicking(open)
              if (!open) requestAnimationFrame(() => input.current?.focus())
            }}
            onChange={(model) => {
              change(Composer.withModel(draft, model))
              requestAnimationFrame(() => input.current?.focus())
            }}
          />
        ) : null
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
      suggestions={
        suggested.suggestions.length > 0 ? (
          <ConversationShell.Suggestions
            label={suggested.label}
            items={suggested.suggestions}
            active={suggested.active}
            onActiveChange={(value) => setSuggesting((current) => current && { ...current, active: value })}
            onSelect={choose}
          />
        ) : undefined
      }
      queue={
        <ComposerQueue sessionID={props.sessionID} queued={queued} running={running} moving={moving} onMove={move} />
      }
      attachments={
        draft.pasted.length > 0 ? (
          <PastedBlocks
            pasted={draft.pasted}
            disabled={readOnly}
            onRemove={(id) => change(Composer.removePasted(draft, id))}
            onShow={(id) => {
              const shown = Composer.showPasted(draft, id, input.current?.selectionStart ?? draft.text.length)
              change(shown.draft)
              caret(shown.cursor, shown.draft.text)
            }}
          />
        ) : undefined
      }
      leading={addMenu}
      footerLeading={addMenu}
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
        readOnly={readOnly}
        value={draft.text}
        mentions={tokens.map((token) => ({
          start: token.start,
          end: token.end,
          kind: token.item.kind,
          label: token.item.label,
        }))}
        {...(suggested.active !== undefined && { activeSuggestion: suggested.active })}
        onChange={(event) => retype(event.currentTarget.value, event.currentTarget.selectionStart)}
        onPaste={(event) => {
          const data = event.clipboardData
          const text = data.getData("text/plain")
          const kind = Composer.paste(
            { types: [...data.types], kinds: [...data.items].map((item) => item.kind), text },
            { readClipboardImage: platform.readClipboardImage !== undefined },
          )
          if (kind === "text") return
          event.preventDefault()
          if (kind === "attachment") Toast.manager.add({ title: "Files can’t be attached yet" })
          else change(Composer.addPasted(draft, { id: SessionMessage.ID.create(), text }))
        }}
        onKeyDown={(event) => {
          const pressed = press(event)
          const node = event.currentTarget
          if (
            pick(pressed) ||
            unmention(node, event.key) ||
            act(ComposerKeys.intent(pressed, { running: stoppable }), node)
          )
            event.preventDefault()
        }}
      />
    </ConversationShell.Composer>
  )
}
