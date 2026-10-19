import { Composer, ComposerHistory } from "@ren/chat"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session-message"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { Viewport } from "../../platform/viewport.js"
import { ComposerModelPicker } from "./composer-model-picker.js"
import { SessionDrafts } from "./session-drafts.js"

const historyKey = "history"

export function NewChat(props: { name: string; userId: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [sessionID, setSessionID] = useState(() => Session.ID.create())
  const spaces = useQuery(context.api.space.list.queryOptions({ page: 1, pageSize: 100 }))
  const models = useQuery(context.api.chat.models.queryOptions({ id: sessionID }))
  const create = useMutation(context.api.session.create.mutationOptions())
  const platform = Platform.usePlatform()
  const mobile = Viewport.useMobile()
  const input = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(() => Composer.decode(platform.drafts?.get(SessionDrafts.fresh)))
  const [chosen, setChosen] = useState<string>()
  const options = (spaces.data?.items ?? []).map((space) => ({ value: space.id, label: space.name }))
  const spaceId = chosen ?? options.at(0)?.value
  const list = models.data ?? []
  const model = Composer.model(draft, undefined, list)
  const text = draft.text.trim()
  const change = (next: Composer.Draft) => {
    setDraft(next)
    const encoded = Composer.encode(next)
    if (encoded) platform.drafts?.set(SessionDrafts.fresh, encoded)
    else platform.drafts?.remove(SessionDrafts.fresh)
  }
  return (
    <ConversationShell.Root
      populated={false}
      composerPosition="centered"
      composer={
        <>
          <Text purpose="title" alignment="center">
            Welcome, {props.name}
          </Text>
          <ConversationShell.Composer
            label="Start a chat"
            onSubmit={() => {
              if (!text || !spaceId || create.isPending) return
              const message = { id: SessionMessage.ID.create(), text }
              create.mutate(
                { id: sessionID, spaceId, message, ...(model && { model }) },
                {
                  onSuccess: () => {
                    platform.drafts?.remove(SessionDrafts.fresh)
                    platform.drafts?.set(
                      historyKey,
                      ComposerHistory.encode(
                        ComposerHistory.prepend(ComposerHistory.decode(platform.drafts.get(historyKey)), {
                          text: draft.text,
                          pasted: [],
                        }),
                      ),
                    )
                    void queryClient.invalidateQueries({ queryKey: context.api.session.list.queryKey() })
                    void import("../../lib/chat.js")
                      .then((loaded) => loaded.Chat.forUser(platform, props.userId).atoms.handoff(sessionID, message))
                      .finally(() => {
                        void navigate({ to: "/sessions/$sessionId", params: { sessionId: sessionID } })
                      })
                  },
                  onError: (error) => {
                    setSessionID(Session.ID.create())
                    Toast.manager.add({
                      type: "error",
                      title: "Could not start the chat",
                      description: error instanceof Error ? error.message : String(error),
                    })
                  },
                },
              )
            }}
            footerLeading={
              <Select.Root
                label="Space"
                appearance="plain"
                size="small"
                options={options}
                value={spaceId ?? null}
                onValueChange={setChosen}
                placeholder="Choose a space"
              />
            }
            footerTrailing={
              <>
                {models.isPending || list.length > 0 ? (
                  <ComposerModelPicker
                    models={list}
                    selected={model}
                    loading={models.isPending}
                    disabled={create.isPending}
                    onChange={(picked) => {
                      change(Composer.withModel(draft, picked))
                      requestAnimationFrame(() => input.current?.focus())
                    }}
                  />
                ) : null}
                <ConversationShell.ComposerSubmit
                  running={false}
                  content={Boolean(text)}
                  starting={create.isPending}
                  disabled={!text || !spaceId}
                  onStop={() => undefined}
                />
              </>
            }
          >
            <ConversationShell.ComposerInput
              ref={input}
              aria-label="Message"
              placeholder="Draft the quarterly report from the finance sheet"
              dir="auto"
              autoComplete="off"
              focusOnMount={!mobile}
              readOnly={create.isPending}
              value={draft.text}
              onChange={(event) => change(Composer.withText(draft, event.currentTarget.value))}
            />
          </ConversationShell.Composer>
        </>
      }
    />
  )
}
