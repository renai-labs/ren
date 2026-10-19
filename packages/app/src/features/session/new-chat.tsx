import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session-message"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"

export function NewChat(props: { name: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const spaces = useQuery(context.api.space.list.queryOptions({ page: 1, pageSize: 100 }))
  const create = useMutation(context.api.session.create.mutationOptions())
  const [draft, setDraft] = useState("")
  const [chosen, setChosen] = useState<string>()
  const options = (spaces.data?.items ?? []).map((space) => ({ value: space.id, label: space.name }))
  const spaceId = chosen ?? options.at(0)?.value
  const text = draft.trim()
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
              <IconButton
                type="submit"
                appearance={text ? "primary" : "secondary"}
                shape="circle"
                size="medium"
                label="Send"
                pending={create.isPending}
                disabled={!text || !spaceId}
              >
                <Icon glyph="ArrowUp" />
              </IconButton>
            }
          >
            <ConversationShell.ComposerInput
              aria-label="Message"
              placeholder="Draft the quarterly report from the finance sheet"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </ConversationShell.Composer>
        </>
      }
    />
  )
}
