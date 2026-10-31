import { Composer, ComposerHistory, Mentions } from "@ren/chat"
import { Session } from "@ren/schema/session"
import { SessionModel } from "@ren/schema/session/model"
import { SessionMessage } from "@ren/schema/session/message"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
import { Icon } from "@ren/ui/icon"
import { Logotype } from "@ren/ui/logotype"
import { Message, MessageContent } from "@ren/ui/message"
import { PromptInput } from "@ren/ui/prompt-input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { toast } from "@ren/ui/toast"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { startTransition, useId, useRef, useState, ViewTransition } from "react"
import { Attention } from "../../lib/attention.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { Viewport } from "../../platform/viewport.js"
import { Failure } from "./failure.js"
import { ComposerAddMenu } from "./composer-add-menu.js"
import { ComposerModelPicker } from "./composer-model-picker.js"
import type { ComposerRepositories } from "./composer-repositories.js"
import { pressOf, useSuggesting, useSuggestions } from "./composer-suggestions.js"
import { SessionApps } from "./session-apps.js"
import { SpaceAppsStrip } from "../../components/apps-strip.js"
import { ChatComposer } from "./chat-composer.js"
import { ComposerCopy } from "./composer-copy.js"
import { SessionDrafts } from "./session-drafts.js"
import { Working } from "./transcript-notice.js"

// oxlint-disable-next-line ren/no-comments -- With no listed pick the chat uses the space's default model, or the first listed model, and sends it.
const listed = (
  models: ReadonlyArray<SessionModel.Choice>,
  picks: ReadonlyArray<SessionModel.Ref | null | undefined>,
) => picks.find((pick) => pick && models.some((item) => SessionModel.key(item) === SessionModel.key(pick))) ?? undefined

function useDefaultModel(input: {
  spaceId: string | undefined
  list: ReadonlyArray<SessionModel.Choice>
  draft: SessionModel.Ref | undefined
}) {
  const context = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const settings = useQuery({
    ...context.api["space-settings"].get.queryOptions({ idOrSlug: input.spaceId ?? "" }),
    enabled: input.spaceId !== undefined,
    retry: false,
  }).data?.settings.model
  const first = input.list.at(0)
  return listed(input.list, [
    input.draft,
    ChatPreferences.model.read(platform.storage),
    settings && {
      id: settings.modelId,
      providerID: settings.endpointId,
      ...(settings.variant && { variant: settings.variant }),
    },
    first && {
      id: first.id,
      providerID: first.providerID,
      ...(first.variants.some((variant) => variant.id === "medium") && { variant: "medium" }),
    },
  ])
}

export function NewChat(props: { userId: string; addRepositories: ComposerRepositories.Dialog }) {
  const context = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const [sessionID, setSessionID] = useState(() => Session.ID.create())
  const [sent, setSent] = useState<string>()
  const transitionName = `new-chat-${useId()}`
  const spaces = useQuery(context.api.space.list.queryOptions({ page: 1, pageSize: 100, joined: true }))
  const models = useQuery(context.api.chat.models.queryOptions({ id: sessionID }))
  const create = useMutation(context.api.session.create.mutationOptions())
  const prepare = useMutation(context.api.chat.prepare.mutationOptions())
  const prepared = useRef(new Set<string>())
  const platform = Platform.usePlatform()
  const mobile = Viewport.useMobile()
  const input = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(() => Composer.decode(platform.drafts?.get(SessionDrafts.fresh)))
  const [chosen, setChosen] = useState<string>()
  const options = (spaces.data?.items ?? []).map((space) => ({ value: space.id, label: space.name }))
  const spaceId = chosen ?? options.at(0)?.value
  const list = models.data ?? []
  const model = useDefaultModel({ spaceId, list, draft: draft.model })
  const mentionable = SessionApps.useMentionable()
  const query = useSuggesting()
  const suggested = useSuggestions({
    state: query,
    catalog: {
      byId: new Map(mentionable.map((app) => [app.id, app])),
      apps: mentionable.map(Mentions.fromApp),
      agents: [],
      skills: [],
      files: [],
    },
    offered: [],
    client: [],
    text: draft.text,
    readOnly: create.isPending,
    field: input,
    onText: (next) => change(Composer.withText(draft, next)),
    onClient: () => undefined,
    side: "bottom",
  })
  const text = draft.text.trim()
  const change = (next: Composer.Draft) => {
    if (spaceId && next.text.trim() && !prepared.current.has(spaceId)) {
      prepared.current.add(spaceId)
      prepare.mutate({ id: spaceId })
    }
    setDraft(next)
    const encoded = Composer.encode(next)
    if (encoded) platform.drafts?.set(SessionDrafts.fresh, encoded)
    else platform.drafts?.remove(SessionDrafts.fresh)
  }
  if (sent !== undefined)
    return (
      <div data-slot="chat" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex w-full max-w-192 flex-col gap-6 px-4 pt-14 pb-8 md:px-6">
          <Message align="end">
            <MessageContent className="max-w-5/6 items-end">
              <ViewTransition name={transitionName} share="auto" default="none">
                <Bubble variant="muted" align="end">
                  <BubbleContent className="rounded-tr-lg px-4 text-base/relaxed whitespace-pre-wrap">
                    {sent}
                  </BubbleContent>
                </Bubble>
              </ViewTransition>
            </MessageContent>
          </Message>
          <Working label="Starting the chat" />
        </div>
      </div>
    )
  return (
    <div data-slot="chat" className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-4 md:px-6">
      <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Logotype size="display" tone="watermark" drawing="outline" label="" />
      </span>
      <div className="relative flex w-full max-w-192 flex-col">
        <ChatComposer
          label="Start a chat"
          header={
            <Select
              items={[{ value: null, label: "Choose a space" }, ...options]}
              value={spaceId ?? null}
              onValueChange={(next) => next && setChosen(next)}
              disabled={create.isPending}
            >
              <SelectTrigger
                aria-label="Space"
                className="gap-2 border-0 px-1 text-muted-foreground hover:text-foreground data-popup-open:text-foreground"
              >
                <span className="text-muted-foreground">Working in</span>
                <Icon glyph="Cube" />
                <SelectValue className="text-foreground" />
              </SelectTrigger>
              <SelectContent align="start" className="w-72">
                <SelectGroup>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          }
          suggestions={suggested.panel}
          addMenu={
            <ComposerAddMenu
              disabled={create.isPending}
              spaceId={spaceId}
              addRepositories={props.addRepositories}
              populated={Boolean(text)}
              commands={suggested.runnable}
              onCommands={suggested.openCommands}
              onCommand={suggested.runCommand}
              onMention={suggested.mention}
            />
          }
          apps={spaceId ? <SpaceAppsStrip spaceId={spaceId} /> : null}
          onSubmit={() => {
            if (!text || !spaceId || create.isPending) return
            Attention.ask(platform)
            const message = { id: SessionMessage.ID.create(), text: suggested.resolve(text).text }
            SessionDrafts.keepPending(platform.drafts, sessionID, message)
            startTransition(() => setSent(text))
            create.mutate(
              { id: sessionID, spaceId, message, ...(model && { model }) },
              {
                onSuccess: () => {
                  platform.drafts?.remove(SessionDrafts.fresh)
                  platform.drafts?.set(
                    SessionDrafts.history,
                    ComposerHistory.encode(
                      ComposerHistory.prepend(ComposerHistory.decode(platform.drafts.get(SessionDrafts.history)), {
                        text: draft.text,
                        pasted: [],
                      }),
                    ),
                  )
                  void import("../../lib/chat.js")
                    .then((loaded) => loaded.Chat.forUser(platform, props.userId).atoms.handoff(sessionID, message))
                    .finally(() => {
                      void navigate({ to: "/sessions/$sessionId", params: { sessionId: sessionID } })
                    })
                },
                onError: (error) => {
                  startTransition(() => setSent(undefined))
                  setSessionID(Session.ID.create())
                  toast.add({
                    type: "error",
                    title: "Could not start the chat",
                    description: Failure.describe(error),
                  })
                },
              },
            )
          }}
          controls={
            <>
              {models.isPending || list.length > 0 ? (
                <ComposerModelPicker
                  models={list}
                  selected={model}
                  loading={models.isPending}
                  disabled={create.isPending}
                  onChange={(picked) => {
                    ChatPreferences.model.write(platform.storage, picked)
                    change(Composer.withModel(draft, picked))
                    requestAnimationFrame(() => input.current?.focus())
                  }}
                />
              ) : null}
              <PromptInput.Submit
                running={false}
                content={Boolean(text)}
                starting={create.isPending}
                disabled={!text || !spaceId}
                onStop={() => undefined}
              />
            </>
          }
        >
          <ViewTransition name={transitionName} share="auto" default="none">
            <PromptInput.Textarea
              ref={input}
              size="lg"
              aria-label="Message"
              placeholder={ComposerCopy.placeholder}
              dir="auto"
              autoComplete="off"
              focusOnMount={!mobile}
              readOnly={create.isPending}
              value={draft.text}
              {...suggested.textarea}
              onChange={(event) => {
                suggested.track(event.currentTarget.value, event.currentTarget.selectionStart)
                change(Composer.withText(draft, event.currentTarget.value))
              }}
              onKeyDown={(event) => {
                if (suggested.keyDown(pressOf(event), event.currentTarget)) event.preventDefault()
              }}
            />
          </ViewTransition>
        </ChatComposer>
      </div>
    </div>
  )
}
