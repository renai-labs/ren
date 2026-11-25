import { useState, type ReactNode } from "react"
import type { ChannelProvider } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconArrowUpRight, IconChevronRight } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Item, ItemMedia } from "@ren/ui/item"
import { Spinner } from "@ren/ui/spinner"
import { CustomAppDialog } from "../../components/custom-app-dialog.js"
import { InviteMembersDialog } from "../../components/invite-members-dialog.js"
import { ProfileDialog } from "../../components/profile-dialog.js"
import { AppRegistryLists } from "../../lib/app-registry.js"
import { Channels } from "../../lib/channels.js"
import { errorMessage } from "../../lib/errors.js"
import { Onboarding } from "../../lib/onboarding.js"
import { RouterContext } from "../../lib/router-context.js"
import { GuideDialog } from "./guide-dialog.js"
import { ImportMemoryDialog } from "./import-memory-dialog.js"

interface Row {
  readonly className: string
  readonly children: ReactNode
}

export function StepAction(props: Row & { action: Onboarding.Action }) {
  const action = props.action
  if (action.kind === "external") return <ExternalAction href={action.href} row={props} />
  if (action.kind === "channel") return <ChannelAction provider={action.provider} row={props} />
  if (action.kind === "provider") return <ProviderAction row={props} />
  if (action.kind === "app") return <AppAction slug={action.slug} row={props} />
  if (action.kind === "chat") return <ChatAction prompt={action.prompt} row={props} />
  if (action.kind === "page") return <PageAction to={action.to} row={props} />
  return <DialogAction action={action} row={props} />
}

function RowButton(props: { row: Row; pending?: boolean; trail?: "open" | "external"; onClick: () => void }) {
  const Trail = props.trail === "external" ? IconArrowUpRight : IconChevronRight
  return (
    <Item
      render={<button type="button" aria-busy={props.pending} disabled={props.pending} onClick={props.onClick} />}
      className={props.row.className}
    >
      {props.row.children}
      <ItemMedia variant="icon" className="text-muted-foreground">
        {props.pending ? <Spinner /> : <Trail aria-hidden />}
      </ItemMedia>
    </Item>
  )
}

function ExternalAction(props: { href: string; row: Row }) {
  const { platform } = RouterContext.useRouterContext()
  return <RowButton row={props.row} trail="external" onClick={() => platform.openExternal(props.href)} />
}

function ChannelAction(props: { provider: ChannelProvider; row: Row }) {
  const { api, platform } = RouterContext.useRouterContext()
  const start = useMutation(api["channel-connect"]["channel-install"].start.mutationOptions())
  const title = Channels.byId[props.provider].title
  return (
    <RowButton
      row={props.row}
      pending={start.isPending}
      onClick={() =>
        start.mutate(
          { provider: props.provider },
          {
            onSuccess: (result) => platform.redirect?.(result.redirectUrl),
            onError: (error) =>
              toast.error(`Couldn’t connect ${title}`, { description: errorMessage(error), duration: Infinity }),
          },
        )
      }
    />
  )
}

function ProviderAction(props: { row: Row }) {
  const { api, platform } = RouterContext.useRouterContext()
  const connect = useMutation(api["ren-inference"].connect.mutationOptions())
  return (
    <RowButton
      row={props.row}
      pending={connect.isPending}
      onClick={() =>
        connect.mutate(
          { returnUrl: `${platform.appUrl}/settings/onboarding` },
          {
            onSuccess: (result) => {
              platform.openExternal(result.url)
              toast("Sign-in opened in a new tab", {
                description:
                  "Sign in to your Claude or ChatGPT subscription there. It shows in Settings → Providers when you finish.",
              })
            },
            onError: (error) => toast.error("Couldn’t start the sign-in", { description: errorMessage(error) }),
          },
        )
      }
    />
  )
}

function AppAction(props: { slug: string; row: Row }) {
  const { api } = RouterContext.useRouterContext()
  const registry = useQuery(AppRegistryLists.bySlugs(api, Onboarding.appSlugs))
  const appId = registry.data?.items.find((app) => app.slug === props.slug)?.id
  const [open, setOpen] = useState(false)
  return (
    <>
      <RowButton
        row={props.row}
        pending={registry.isPending}
        onClick={() =>
          appId
            ? setOpen(true)
            : toast.error("This app isn’t available on this server", {
                description: "Pick another app from the list, or ask an admin to add it.",
              })
        }
      />
      {open && appId ? <ProfileDialog appId={appId} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function ChatAction(props: { prompt: string; row: Row }) {
  return (
    <Item
      render={<Link to="/" search={{ prompt: props.prompt }} target="_blank" rel="noopener" />}
      className={props.row.className}
    >
      {props.row.children}
      <span className="sr-only">(opens in a new tab)</span>
      <ItemMedia variant="icon" className="text-muted-foreground">
        <IconArrowUpRight aria-hidden />
      </ItemMedia>
    </Item>
  )
}

function PageAction(props: { to: "/automations/new"; row: Row }) {
  return (
    <Item render={<Link to={props.to} />} className={props.row.className}>
      {props.row.children}
      <ItemMedia variant="icon" className="text-muted-foreground">
        <IconChevronRight aria-hidden />
      </ItemMedia>
    </Item>
  )
}

function DialogAction(props: {
  action: Exclude<Onboarding.Action, { readonly kind: "external" | "channel" | "provider" | "app" | "chat" | "page" }>
  row: Row
}) {
  const [open, setOpen] = useState(false)
  const action = props.action
  const close = () => setOpen(false)
  return (
    <>
      <RowButton row={props.row} onClick={() => setOpen(true)} />
      {action.kind === "custom-app" && open ? <CustomAppDialog onClose={close} /> : null}
      {action.kind === "import-memory" ? <ImportMemoryDialog open={open} onOpenChange={setOpen} /> : null}
      {action.kind === "invite" && open ? <InviteMembersDialog open onOpenChange={setOpen} /> : null}
      {action.kind === "guide" ? <GuideDialog guide={action.guide} open={open} onOpenChange={setOpen} /> : null}
    </>
  )
}
