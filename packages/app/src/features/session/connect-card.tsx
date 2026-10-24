import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { Icon } from "@ren/ui/icon"
import { Toast } from "@ren/ui/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { PasteCredentialDialog } from "../../components/paste-credential-dialog.js"

// oxlint-disable-next-line ren/no-comments -- The card for a ren_connect tool part (A9). The agent names only the label; the person types the hosts, and the card says the agent asked, so a prompt-injected agent cannot send a key to its own host (A40). After the save, "connected <LABEL>" starts the agent's next turn (A42).
export function ConnectCard(props: {
  sessionID: string
  label: string
  onConnected: (text: string) => Promise<unknown>
}) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const session = useQuery(context.api.session.get.queryOptions({ idOrSlug: props.sessionID }))
  const space = useQuery({
    ...context.api.space.get.queryOptions({ idOrSlug: session.data?.spaceId ?? "" }),
    enabled: Boolean(session.data),
  })
  const [open, setOpen] = useState(false)
  const [connected, setConnected] = useState(false)
  const spaceId = session.data?.spaceId
  return (
    <>
      <Card.Root
        layout="row"
        media={<Icon glyph="KeyRound" />}
        mediaPlacement="inline"
        title={connected ? `${props.label} connected` : `Connect ${props.label}`}
        description={
          connected
            ? "The agent goes on with the key."
            : "The agent needs this key to go on. Only add it if you expected this request."
        }
        actions={
          connected ? null : (
            <Button appearance="primary" size="small" disabled={!spaceId} onClick={() => setOpen(true)}>
              Add key
            </Button>
          )
        }
      />
      {open && spaceId ? (
        <PasteCredentialDialog
          title={`Connect ${props.label}`}
          description="Paste the key and name the hosts it is for."
          warning={`The agent asked for ${props.label}. Check the hosts: Ren sends the key only there, and never to a host the agent names.`}
          owners={[{ value: `space:${spaceId}`, label: `Everyone in ${space.data?.name ?? "this space"}` }]}
          userId=""
          defaults={{ label: props.label }}
          labelFixed
          submitLabel="Connect key"
          onClose={() => setOpen(false)}
          onSaved={async () => {
            setConnected(true)
            await queryClient.invalidateQueries({ queryKey: context.api.credential.list.queryKey() })
            await props.onConnected(`connected ${props.label}`).catch(() =>
              Toast.manager.add({
                type: "error",
                title: "Could not tell the agent",
                description: `The key is saved. Send “connected ${props.label}” to go on.`,
              }),
            )
          }}
        />
      ) : null}
    </>
  )
}
