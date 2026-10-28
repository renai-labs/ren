import type { ChannelInstallInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@ren/ui/field"
import { Icon } from "@ren/ui/icon"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@ren/ui/item"
import { PageShell } from "@ren/ui/page-shell"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { toast } from "@ren/ui/toast"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { ChannelRoutes } from "./channel-routes.js"
import { Channels } from "./channels.js"

const page = { page: 1, pageSize: Pagination.maximumPageSize }

const first = "first"

export function ChannelProviderPage(props: {
  provider: Channels.Provider
  userId: string
  installed?: string | undefined
  error?: string | undefined
}) {
  const context = RouterContext.useRouterContext()
  const provider = Channels.byId[props.provider]
  const installs = useQuery({
    ...context.api["channel-install"].list.queryOptions(page),
    refetchOnWindowFocus: "always",
  })
  const remove = useMutation(context.api["channel-install"].remove.mutationOptions())
  const [resetting, setResetting] = useState(false)
  const install = installs.data?.items.find((each) => each.provider === provider.id)
  return (
    <PageShell.Root
      layout="settings"
      context={
        <Link
          to="/settings/channels"
          className={buttonVariants({ variant: "ghost", size: "xs", className: "h-6.5 text-muted-foreground" })}
        >
          <Icon glyph="ArrowLeft" data-icon="inline-start" />
          Back to channels
        </Link>
      }
      media={<Icon glyph={provider.glyph} size="large" tone="primary" />}
      title={provider.title}
      actions={
        install ? (
          <Button variant="outline" size="xs" className="h-6.5" onClick={() => setResetting(true)}>
            <Icon glyph="Unplug" data-icon="inline-start" />
            Reset mappings
          </Button>
        ) : undefined
      }
    >
      <InstallOutcome title={provider.title} installed={props.installed} error={props.error} />
      {install ? (
        <>
          <ItemGroup aria-label={`${provider.title} install`} className="gap-0 rounded-xl border bg-card">
            <Item
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Item renders a div inside the ItemGroup list
              role="listitem"
              className="min-h-14 gap-x-6 gap-y-2 px-4 py-3"
            >
              <ItemContent>
                <ItemTitle className="leading-5">{install.name}</ItemTitle>
                <ItemDescription className="text-xs">
                  {install.installedBy ? `Installed by ${install.installedBy.name}` : "Installed by a former member"}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="text-muted-foreground">
                <Time value={install.createdAt} format="date" label="Installed" />
              </ItemActions>
            </Item>
          </ItemGroup>
          <PageShell.Section frame="divided">
            <DefaultSpace install={install} noun={provider.place.noun} />
          </PageShell.Section>
          <ChannelRoutes install={install} userId={props.userId} />
        </>
      ) : (
        <Text purpose="body" tone="secondary">
          Connect {provider.title} from the{" "}
          <Link to="/settings/channels" className={buttonVariants({ variant: "link", className: "h-auto p-0" })}>
            Channels page
          </Link>{" "}
          before configuring it.
        </Text>
      )}
      <ConfirmationDialog
        open={resetting}
        onOpenChange={setResetting}
        title={`Reset ${provider.title} mappings?`}
        description={`This clears every mapping and uninstalls Ren from ${provider.title}. You can install it again later.`}
        confirmLabel="Reset mappings"
        tone="danger"
        onConfirm={async () => {
          if (!install) return
          await remove.mutateAsync({ id: install.id })
        }}
        onConfirmed={() => toast.add({ type: "success", title: `${provider.title} mappings reset` })}
      />
    </PageShell.Root>
  )
}

function DefaultSpace(props: { install: ChannelInstallInfo; noun: string }) {
  const context = RouterContext.useRouterContext()
  const spaces = useQuery(context.api.space.list.queryOptions({ ...page, joined: true }))
  const update = useMutation(context.api["channel-install"].update.mutationOptions())
  const current = props.install.defaultSpace
  const options = [
    { value: first, label: "Organization’s first space" },
    ...(current && !spaces.data?.items.some((space) => space.id === current.id)
      ? [{ value: current.id, label: current.name }]
      : []),
    ...(spaces.data?.items ?? []).map((space) => ({ value: space.id, label: space.name })),
  ]
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="default-space">Default space</FieldLabel>
        <FieldDescription>
          Messages from {props.noun === "repository" ? "repositories" : `${props.noun}s`} with no mapping go here.
        </FieldDescription>
      </FieldContent>
      <Select
        items={options}
        disabled={!props.install.canUpdate || update.isPending}
        value={current?.id ?? first}
        onValueChange={(chosen) => {
          if (!chosen) return
          void update
            .mutateAsync({ id: props.install.id, defaultSpaceId: chosen === first ? null : chosen })
            .catch((cause: unknown) =>
              toast.add({
                type: "error",
                title: "Couldn’t change the default space",
                description: Channels.describe(cause),
              }),
            )
        }}
      >
        <SelectTrigger id="default-space" aria-label="Default space" className="max-w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

function InstallOutcome(props: { title: string; installed: string | undefined; error: string | undefined }) {
  if (props.error)
    return (
      <Alert variant="destructive">
        <Icon glyph="AlertCircle" />
        <AlertTitle>Couldn’t install Ren on {props.title}</AlertTitle>
        <AlertDescription>{props.error}</AlertDescription>
      </Alert>
    )
  if (props.installed)
    return (
      <Alert>
        <Icon glyph="Info" />
        <AlertTitle>Ren is installed on {props.title}</AlertTitle>
        <AlertDescription>{props.installed}</AlertDescription>
      </Alert>
    )
  return null
}
