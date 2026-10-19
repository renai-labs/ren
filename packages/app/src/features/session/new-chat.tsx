import { Composer, ComposerHistory } from "@ren/chat"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session-message"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { Viewport } from "../../platform/viewport.js"

const draftKey = "new"
const historyKey = "history"

export function NewChat(props: { name: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const spaces = useQuery(context.api.space.list.queryOptions({ page: 1, pageSize: 100 }))
  const create = useMutation(context.api.session.create.mutationOptions())
  const platform = Platform.usePlatform()
  const mobile = Viewport.useMobile()
  const [draft, setDraft] = useState(() => Composer.decode(platform.drafts?.get(draftKey)).text)
  const [chosen, setChosen] = useState<string>()
  const options = (spaces.data?.items ?? []).map((space) => ({ value: space.id, label: space.name }))
  const spaceId = chosen ?? options.at(0)?.value
  const text = draft.trim()
  const change = (next: string) => {
    setDraft(next)
    const encoded = Composer.encode(Composer.withText(Composer.empty, next))
    if (encoded) platform.drafts?.set(draftKey, encoded)
    else platform.drafts?.remove(draftKey)
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
              const id = Session.ID.create()
              create.mutate(
                { id, spaceId, message: { id: SessionMessage.ID.create(), text } },
                {
                  onSuccess: () => {
                    platform.drafts?.remove(draftKey)
                    platform.drafts?.set(
                      historyKey,
                      ComposerHistory.encode(
                        ComposerHistory.prepend(ComposerHistory.decode(platform.drafts.get(historyKey)), {
                          text: draft,
                          pasted: [],
                        }),
                      ),
                    )
                    void queryClient.invalidateQueries({ queryKey: context.api.session.list.queryKey() })
                    void navigate({ to: "/sessions/$sessionId", params: { sessionId: id } })
                  },
                  onError: (error) =>
                    Toast.manager.add({
                      type: "error",
                      title: "Could not start the chat",
                      description: error instanceof Error ? error.message : String(error),
                    }),
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
              <ConversationShell.ComposerSubmit
                running={false}
                content={Boolean(text)}
                starting={create.isPending}
                disabled={!text || !spaceId}
                onStop={() => undefined}
              />
            }
          >
            <ConversationShell.ComposerInput
              aria-label="Message"
              placeholder="Draft the quarterly report from the finance sheet"
              dir="auto"
              autoComplete="off"
              focusOnMount={!mobile}
              readOnly={create.isPending}
              value={draft}
              onChange={(event) => change(event.currentTarget.value)}
            />
          </ConversationShell.Composer>
        </>
      }
    />
  )
}
