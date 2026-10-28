import type { ChannelInstallInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Field } from "@ren/ui/field"
import { Icon } from "@ren/ui/icon"
import { List } from "@ren/ui/list"
import { Notice } from "@ren/ui/notice"
import { PageShell } from "@ren/ui/page-shell"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { Toast } from "@ren/ui/toast"
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
        <Button appearance="link" leadingIcon={<Icon glyph="ArrowLeft" />} render={<Link to="/settings/channels" />}>
          Back to channels
        </Button>
      }
      media={<Icon glyph={provider.glyph} size="large" tone="primary" />}
      title={provider.title}
      actions={
        install ? (
          <Button
            appearance="outline"
            size="small"
            leadingIcon={<Icon glyph="Unplug" />}
            onClick={() => setResetting(true)}
          >
            Reset mappings
          </Button>
        ) : undefined
      }
    >
      <InstallOutcome title={provider.title} installed={props.installed} error={props.error} />
      {install ? (
        <>
          <List.Root label={`${provider.title} install`}>
            <List.Item
              title={install.name}
              description={
                install.installedBy ? `Installed by ${install.installedBy.name}` : "Installed by a former member"
              }
              trailing={<Time value={install.createdAt} format="date" label="Installed" />}
            />
          </List.Root>
          <PageShell.Section frame="divided">
            <DefaultSpace install={install} noun={provider.place.noun} />
          </PageShell.Section>
          <ChannelRoutes install={install} userId={props.userId} />
        </>
      ) : (
        <Text purpose="body" tone="secondary">
          Connect {provider.title} from the{" "}
          <Button appearance="link" render={<Link to="/settings/channels" />}>
            Channels page
          </Button>{" "}
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
        onConfirmed={() => Toast.manager.add({ type: "success", title: `${provider.title} mappings reset` })}
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
    <Field.Root
      label="Default space"
      orientation="row"
      description={`Messages from ${props.noun === "repository" ? "repositories" : `${props.noun}s`} with no mapping go here. `}
    >
      <Select.Root
        label="Default space"
        width="limited"
        disabled={!props.install.canUpdate || update.isPending}
        value={current?.id ?? first}
        onValueChange={(chosen) =>
          void update
            .mutateAsync({ id: props.install.id, defaultSpaceId: chosen === first ? null : chosen })
            .catch((cause: unknown) =>
              Toast.manager.add({
                type: "error",
                title: "Couldn’t change the default space",
                description: Channels.describe(cause),
              }),
            )
        }
        options={options}
      />
    </Field.Root>
  )
}

function InstallOutcome(props: { title: string; installed: string | undefined; error: string | undefined }) {
  if (props.error)
    return (
      <Notice tone="danger" title={`Couldn’t install Ren on ${props.title}`}>
        {props.error}
      </Notice>
    )
  if (props.installed)
    return (
      <Notice tone="information" title={`Ren is installed on ${props.title}`}>
        {props.installed}
      </Notice>
    )
  return null
}
