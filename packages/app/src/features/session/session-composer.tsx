import { ChatState, ClientCommand, Composer, ComposerHistory, Mentions } from "@ren/chat"
import type { ChatSession } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionInbox } from "@ren/schema/session/inbox"
import type { SessionInfo } from "@ren/schema/session/info"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import { PromptInput } from "@ren/ui/prompt-input"
import { toast } from "@ren/ui/toast"
import { Effect, Predicate, SubscriptionRef } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useQuery } from "@tanstack/react-query"
import { useRef, useState } from "react"
import type { ReactNode } from "react"
import { Attention } from "../../lib/attention.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Debounce } from "../../lib/debounce.js"
import { DraftStore } from "../../platform/draft-store.js"
import { Keyboard } from "../../platform/keyboard.js"
import { Platform } from "../../platform/platform.js"
import { RouterContext } from "../../lib/router-context.js"
import { Viewport } from "../../platform/viewport.js"
import { SessionAppsStrip } from "../../components/apps-strip.js"
import { ChatComposer } from "./chat-composer.js"
import { ComposerCopy } from "./composer-copy.js"
import { Failure } from "./failure.js"
import { ComposerAddMenu } from "./composer-add-menu.js"
import type { ComposerRepositories } from "./composer-repositories.js"
import { ComposerStatus } from "./composer-status.js"
import { type Catalog, pressOf, useSuggesting, useSuggestions } from "./composer-suggestions.js"
import type { ChatView } from "./chat-view.js"
import { ComposerKeys } from "./composer-keys.js"
import { ComposerModelPicker } from "./composer-model-picker.js"
import { ComposerQueue } from "./composer-queue.js"
import { SessionApps } from "./session-apps.js"
import { SessionDrafts } from "./session-drafts.js"

const fileSearchDelay = 150

const known = (state: ChatState.State, sessionID: Session.ID, id: SessionMessage.ID) =>
  ChatState.messages(state, sessionID).some((item) => item.id === id) ||
  ChatState.pending(state, sessionID).some((item) => item.id === id)

const listed = <A,>(result: AsyncResult.AsyncResult<ReadonlyArray<A>, unknown>) =>
  AsyncResult.isSuccess(result) ? result.value : []

const clientCommands = (
  info: SessionInfo.Info | undefined,
  history: { readonly prompted: boolean; readonly reverted: boolean },
) => {
  const capabilities = info?.capabilities
  return ClientCommand.offered({
    "model.choose": capabilities?.model !== false,
    "session.compact": capabilities?.compact !== false && history.prompted,
    "session.undo": capabilities?.revert !== false && history.prompted,
    "session.redo": capabilities?.revert !== false && history.reverted,
  })
}

const sessionStatus = (info: SessionInfo.Info | undefined, session: { readonly running: boolean }) => ({
  model: info?.model,
  stoppable: session.running && info?.capabilities.interrupt !== false,
  queue: info?.capabilities.queue !== false,
  commands: info?.capabilities.commands !== false,
  picker: info?.capabilities.model !== false,
})

const startingOf = (notice: ChatView.Notice | undefined) => notice?._tag === "Starting"

// oxlint-disable-next-line ren/no-comments -- While the sandbox starts the composer is read-only and always shows the rotating line; other notices give way to a draft.
const shownNotice = (notice: ChatView.Notice | undefined, draft: Composer.Draft) =>
  notice && (startingOf(notice) || !draft.text) ? notice : undefined

function useMentionCatalog(sessionID: Session.ID, query: string): Catalog {
  const searched = Debounce.useDebouncedValue(query, fileSearchDelay)
  const found = listed(ChatReact.useFiles({ root: sessionID, query: searched, type: "file" }))
  const apps = SessionApps.useMentionable()
  return {
    byId: new Map(apps.map((app) => [app.id, app])),
    apps: apps.map(Mentions.fromApp),
    agents: SessionCatalog.mentionable(listed(ChatReact.useAgents(sessionID))).map(Mentions.fromAgent),
    skills: Composer.offeredSkills(listed(ChatReact.useSkills(sessionID))).map(Mentions.fromSkill),
    files: searched && query ? found.map(Mentions.fromFile) : [],
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
    <PromptInput.PastedText
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
        <PromptInput.Alternate
          label={alternate === "queue" ? "Queue" : "Steer"}
          shortcut={Viewport.shortcut("↵")}
          {...(alternate === "steer" && { description: "Send to the running turn" })}
          onActivate={props.onAlternate}
        />
      ) : null}
      <PromptInput.Submit
        running={props.stoppable}
        content={props.content}
        disabled={props.unavailable}
        onStop={props.onStop}
      />
    </>
  )
}

export function SessionComposer(props: {
  sessionID: Session.ID
  info: SessionInfo.Info | undefined
  running: boolean
  pending: ReadonlyArray<SessionInbox.Info>
  prompted: boolean
  reverted: boolean
  unavailable: boolean
  covered: boolean
  notice: ChatView.Notice | undefined
  retrying: boolean
  onRetry: () => void
  onUndo: () => void
  onRedo: () => void
  onCompact: () => void
  picking: boolean
  onPicking: (open: boolean) => void
  addRepositories?: ComposerRepositories.Dialog | undefined
}) {
  const platform = Platform.usePlatform()
  const mobile = Viewport.useMobile()
  const key = SessionDrafts.key(props.sessionID)
  const behavior = ChatPreferences.followUp.read(platform.storage)
  const [draft, setDraft] = useState(() => Composer.decode(platform.drafts?.get(key)))
  const [history, setHistory] = useState(() => ComposerHistory.decode(platform.drafts?.get(SessionDrafts.history)))
  const [browsing, setBrowsing] = useState(ComposerHistory.idle)
  const query = useSuggesting()
  const context = RouterContext.useRouterContext()
  const spaceId = useQuery({
    ...context.api.session.get.queryOptions({ idOrSlug: props.sessionID }),
    select: (session) => session.spaceId,
  }).data
  const [moving, setMoving] = useState(false)
  const picking = props.picking
  const setPicking = props.onPicking
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
  const typing = ChatReact.useAction(props.sessionID, (opened) => opened.typing)
  const status = sessionStatus(props.info, { running: props.running })
  const running = props.running
  const stoppable = status.stoppable
  const content = !Composer.isBlank(draft)
  const queued = Composer.queued(props.pending)
  const notice = shownNotice(props.notice, draft)
  const unavailable = props.unavailable || startingOf(props.notice)
  const readOnly = unavailable || moving
  const catalog = useMentionCatalog(props.sessionID, query.mention ?? "")
  const listedCommands = Composer.offeredCommands(listed(ChatReact.useCommands(props.sessionID)))
  const offered = status.commands ? listedCommands : []
  const suggested = useSuggestions({
    state: query,
    catalog,
    offered,
    client: clientCommands(props.info, { prompted: props.prompted, reverted: props.reverted }),
    text: draft.text,
    readOnly,
    field: input,
    onText: (text) => {
      setBrowsing(ComposerHistory.idle)
      change(Composer.withText(latest.current.draft, text))
    },
    onClient: (id) => runClient(id),
  })
  const resolve = suggested.resolve

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
    platform.drafts?.set(SessionDrafts.history, ComposerHistory.encode(next))
  }
  const caret = (position: number, text: string) =>
    requestAnimationFrame(() => {
      const node = input.current
      if (!node || node.value !== text) return
      node.focus()
      node.setSelectionRange(position, position)
    })
  const stop = () => void interrupt().catch(Failure.notify("Could not stop Ren"))
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
          toast.add({
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
    Attention.ask(platform)
    const id = submission.retry ?? SessionMessage.ID.create()
    const slash = Composer.slash(submission.text, offered)
    remember(ComposerHistory.prepend(history, submission.sent))
    setBrowsing(ComposerHistory.idle)
    suggested.close()
    change(submission.next)
    if (mobile) input.current?.blur()
    const failure = (title: string) => (error: unknown) => {
      remember(ComposerHistory.remove(latest.current.history, submission.sent))
      change(Composer.restore(latest.current.draft, submission.sent, id))
      toast.add({ type: "error", title, description: `${Failure.describe(error)} Your draft has been kept.` })
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
    suggested.track(text, cursor)
    setBrowsing(ComposerHistory.idle)
    change(Composer.withText(draft, text))
    void typing()
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
      spaceId={spaceId}
      addRepositories={props.addRepositories}
      populated={content}
      commands={suggested.runnable}
      onCommands={suggested.openCommands}
      onCommand={suggested.runCommand}
      onMention={suggested.mention}
    />
  )
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

  const hint = running ? "Also list who reviewed each one" : ComposerCopy.placeholder
  const controls = (
    <Controls
      running={running}
      stoppable={stoppable}
      content={content}
      unavailable={unavailable}
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
              ChatPreferences.model.write(platform.storage, model)
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
    <ChatComposer
      label="Message Ren"
      onSubmit={() => submit(false)}
      suggestions={suggested.panel}
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
      addMenu={addMenu}
      apps={<SessionAppsStrip sessionId={props.sessionID} />}
      {...(notice && {
        status: <ComposerStatus notice={notice} retrying={props.retrying} onRetry={props.onRetry} />,
      })}
      controls={controls}
    >
      <PromptInput.Textarea
        ref={input}
        aria-label="Message"
        dir="auto"
        autoComplete="off"
        focusOnMount={!mobile}
        placeholder={props.notice ? "" : hint}
        readOnly={readOnly}
        value={draft.text}
        {...suggested.textarea}
        onChange={(event) => {
          retype(event.currentTarget.value, event.currentTarget.selectionStart)
        }}
        onPaste={(event) => {
          const data = event.clipboardData
          const text = data.getData("text/plain")
          const kind = Composer.paste(
            { types: [...data.types], kinds: [...data.items].map((item) => item.kind), text },
            { readClipboardImage: platform.readClipboardImage !== undefined },
          )
          if (kind === "text") return
          event.preventDefault()
          if (kind === "attachment") toast.add({ title: "Files can’t be attached yet" })
          else change(Composer.addPasted(draft, { id: SessionMessage.ID.create(), text }))
        }}
        onKeyDown={(event) => {
          const pressed = pressOf(event)
          const node = event.currentTarget
          if (suggested.keyDown(pressed, node) || act(ComposerKeys.intent(pressed, { running: stoppable }), node))
            event.preventDefault()
        }}
      />
    </ChatComposer>
  )
}
