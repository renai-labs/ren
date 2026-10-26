import type { ChannelInstallInfo, ChannelMappingInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Button } from "@ren/ui/button"
import { Combobox } from "@ren/ui/combobox"
import { Dialog } from "@ren/ui/dialog"
import { Field } from "@ren/ui/field"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"
import { Notice } from "@ren/ui/notice"
import { Select } from "@ren/ui/select"
import { Switch } from "@ren/ui/switch"
import { Table } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { Toolbar } from "@ren/ui/toolbar"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"
import { Channels } from "./channels.js"

const page = { page: 1, pageSize: Pagination.maximumPageSize }
const defaultAgent = "default"

export function SpaceChannels(props: { spaceId: string; userId: string }) {
  const context = RouterContext.useRouterContext()
  const installs = useQuery(context.api["channel-install"].list.queryOptions(page))
  return <ChannelMappings installs={installs.data?.items ?? []} spaceId={props.spaceId} userId={props.userId} />
}

export function ChannelMappings(props: {
  installs: ReadonlyArray<ChannelInstallInfo>
  spaceId?: string
  userId: string
}) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const only = props.installs.length === 1 ? props.installs[0] : undefined
  const mappings = useQuery(
    Pages.all((number) =>
      context.api["channel-mapping"].list.queryOptions({
        ...page,
        page: number,
        ...(props.spaceId ? { spaceId: props.spaceId } : only && { installId: only.id }),
      }),
    ),
  )
  const remove = useMutation(context.api["channel-mapping"].remove.mutationOptions())
  const [editing, setEditing] = useState<ChannelMappingInfo | "new">()
  const rows = mappings.data?.items ?? []
  const state = { pending: "loading", error: "failed", success: rows.length > 0 ? "ready" : "empty" } as const
  return (
    <>
      <Toolbar.Root>
        <Button
          appearance="primary"
          size="small"
          leadingIcon={<Icon glyph="Plus" />}
          disabled={props.installs.length === 0}
          onClick={() => setEditing("new")}
        >
          Add mapping
        </Button>
      </Toolbar.Root>
      <Table.Root
        state={state[mappings.status]}
        failureMessage="Couldn’t load mappings."
        emptyMessage={
          props.spaceId
            ? "No channel answers in this space yet. Add a mapping to choose one."
            : "Every place answers in the default space. Add a mapping to send one to another space."
        }
        caption="Mappings"
      >
        <Table.Header>
          <Table.HeaderCell width="fill">Place</Table.HeaderCell>
          {props.spaceId ? null : <Table.HeaderCell width="quarter">Space</Table.HeaderCell>}
          <Table.HeaderCell width="medium" visibility="wide-screens">
            Agent
          </Table.HeaderCell>
          <Table.HeaderCell width="large" visibility="wide-screens">
            Unknown senders
          </Table.HeaderCell>
          <Table.RowActionsHeaderCell />
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <Table.Row key={row.id}>
              <Table.Cell>
                <span className="flex min-w-0 items-center gap-2">
                  <Icon glyph={Channels.byId[row.provider].glyph} tone="secondary" />
                  <Text truncation="single-line" element="span" title={row.placeName}>
                    {row.placeName}
                  </Text>
                </span>
              </Table.Cell>
              {props.spaceId ? null : <Table.Cell>{row.space.name}</Table.Cell>}
              <Table.Cell visibility="wide-screens">{row.agent?.name ?? "ren"}</Table.Cell>
              <Table.Cell visibility="wide-screens">
                {row.fallback ? `Run as ${row.fallbackUser?.name ?? "a former member"}` : "Refused"}
              </Table.Cell>
              <Table.RowActions label="Mapping actions">
                <Menu.Item icon={<Icon glyph="Pencil" />} onSelect={() => setEditing(row)}>
                  Edit mapping
                </Menu.Item>
                <Menu.Item
                  tone="danger"
                  icon={<Icon glyph="Trash2" />}
                  onSelect={() =>
                    void remove.mutateAsync({ id: row.id }).then(
                      () =>
                        Promise.all([
                          queryClient.invalidateQueries({ queryKey: context.api["channel-mapping"].list.queryKey() }),
                          queryClient.invalidateQueries({
                            queryKey: context.api["channel-connect"]["channel-place"].list.queryKey(),
                          }),
                        ]).then(() => Toast.manager.add({ type: "success", title: `${row.placeName} unmapped` })),
                      (cause: unknown) =>
                        Toast.manager.add({
                          type: "error",
                          title: `Couldn’t remove the mapping of ${row.placeName}`,
                          description: Channels.describe(cause),
                        }),
                    )
                  }
                >
                  Remove mapping
                </Menu.Item>
              </Table.RowActions>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      {editing ? (
        <MappingDialog
          installs={props.installs}
          mapping={editing === "new" ? undefined : editing}
          spaceId={props.spaceId}
          userId={props.userId}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  )
}

interface Draft {
  readonly installId: string
  readonly place: { readonly id: string; readonly anyoneCanWrite: boolean } | null
  readonly spaceId: string
  readonly agentId: string | null
  readonly fallback: boolean | null
  readonly fallbackUserId: string
}

const draftOf = (input: {
  readonly installs: ReadonlyArray<ChannelInstallInfo>
  readonly mapping: ChannelMappingInfo | undefined
  readonly spaceId: string | undefined
  readonly userId: string
}): Draft =>
  input.mapping
    ? {
        installId: input.mapping.installId,
        place: { id: input.mapping.place, anyoneCanWrite: false },
        spaceId: input.mapping.space.id,
        agentId: input.mapping.agent?.id ?? null,
        fallback: input.mapping.fallback,
        fallbackUserId: input.mapping.fallbackUser?.id ?? input.userId,
      }
    : {
        installId: input.installs[0]?.id ?? "",
        place: null,
        spaceId: input.spaceId ?? "",
        agentId: null,
        fallback: null,
        fallbackUserId: input.userId,
      }

function MappingDialog(props: {
  installs: ReadonlyArray<ChannelInstallInfo>
  mapping: ChannelMappingInfo | undefined
  spaceId: string | undefined
  userId: string
  onClose: () => void
}) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const create = useMutation(context.api["channel-mapping"].create.mutationOptions())
  const [draft, setDraft] = useState(() => draftOf(props))
  const change = (next: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...next }))
  const install = props.installs.find((each) => each.id === draft.installId)
  const provider = Channels.byId[install?.provider ?? "github"]
  const fallback = draft.fallback ?? !draft.place?.anyoneCanWrite
  const submit = () => {
    if (!draft.place || !draft.spaceId) return
    create.mutate(
      {
        installId: draft.installId,
        place: draft.place.id,
        spaceId: draft.spaceId,
        ...(draft.agentId && { agentId: draft.agentId }),
        fallback,
        fallbackUserId: draft.fallbackUserId,
      },
      {
        onSuccess: (saved) => {
          Toast.manager.add({ type: "success", title: `${saved.placeName} answers in ${saved.space.name}` })
          props.onClose()
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: context.api["channel-mapping"].list.queryKey() }),
            queryClient.invalidateQueries({
              queryKey: context.api["channel-connect"]["channel-place"].list.queryKey(),
            }),
          ])
        },
      },
    )
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={create.isPending ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>{props.mapping ? `Edit ${props.mapping.placeName}` : "Add mapping"}</Dialog.Title>
          <Dialog.Description>
            Ren answers mentions in the {provider.place.noun} with a chat in the space you choose. Changing the space or
            agent starts a new chat on the next message.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          {props.mapping ? null : (
            <PlaceFields installs={props.installs} provider={provider} draft={draft} onChange={change} />
          )}
          <SpaceFields draft={draft} userId={props.userId} onChange={change} />
          <FallbackFields draft={draft} fallback={fallback} onChange={change} />
          <Notice tone="danger" placement="inline">
            {create.error?.message}
          </Notice>
        </Dialog.Body>
        <Dialog.Footer>
          <FormActions.Root>
            <FormActions.Cancel onClick={props.onClose} disabled={create.isPending} />
            <FormActions.Submit
              pending={create.isPending}
              pendingLabel="Saving…"
              disabled={!draft.place || !draft.spaceId}
              onClick={submit}
            >
              {props.mapping ? "Save mapping" : `Map ${provider.place.noun}`}
            </FormActions.Submit>
          </FormActions.Root>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function PlaceFields(props: {
  installs: ReadonlyArray<ChannelInstallInfo>
  provider: Channels.Info
  draft: Draft
  onChange: (next: Partial<Draft>) => void
}) {
  const context = RouterContext.useRouterContext()
  const noun = props.provider.place.noun
  const places = useQuery({
    ...Pages.all((number) =>
      context.api["channel-connect"]["channel-place"].list.queryOptions({
        ...page,
        page: number,
        installId: props.draft.installId,
      }),
    ),
    enabled: props.draft.installId !== "",
  })
  const items = places.data?.items ?? []
  return (
    <>
      {props.installs.length > 1 ? (
        <Field.Root label="Provider">
          <Select.Root
            label="Provider"
            width="full"
            value={props.draft.installId}
            onValueChange={(installId) => props.onChange({ installId, place: null, fallback: null })}
            options={props.installs.map((each) => ({
              value: each.id,
              label: `${Channels.byId[each.provider].title} · ${each.name}`,
              icon: <Icon glyph={Channels.byId[each.provider].glyph} />,
            }))}
          />
        </Field.Root>
      ) : null}
      <Field.Root label={props.provider.place.title}>
        <Combobox.Inline
          label={props.provider.place.title}
          state={({ pending: "loading", error: "failed", success: "ready" } as const)[places.status]}
          searchPlaceholder={`Search ${noun === "repository" ? "repositories" : `${noun}s`}…`}
          emptyMessage="No matches."
          failureMessage="Couldn’t load the list. Try again in a moment."
          value={props.draft.place?.id ?? null}
          onValueChange={(id) => {
            const found = items.find((each) => each.id === id)
            props.onChange({
              place: found ? { id: found.id, anyoneCanWrite: found.anyoneCanWrite } : null,
              fallback: null,
            })
          }}
          items={items.map((each) => ({
            value: each.id,
            label: each.name,
            description: each.mapping ? `Answers in ${each.mapping.space.name}` : undefined,
            icon: <Icon glyph={each.private ? "Lock" : props.provider.glyph} />,
          }))}
        />
      </Field.Root>
    </>
  )
}

function SpaceFields(props: { draft: Draft; userId: string; onChange: (next: Partial<Draft>) => void }) {
  const context = RouterContext.useRouterContext()
  const spaceId = props.draft.spaceId
  const spaces = useQuery(
    Pages.all((number) => context.api.space.list.queryOptions({ ...page, page: number, joined: true })),
  )
  const agents = useQuery({
    ...Pages.all((number) =>
      context.api.agent.list.queryOptions({ ...page, page: number, spaceId, isSubagent: false }),
    ),
    enabled: spaceId !== "",
  })
  return (
    <>
      <Field.Root label="Space">
        <Select.Root
          label="Space"
          width="full"
          placeholder="Choose a space"
          value={spaceId || null}
          onValueChange={(next) => props.onChange({ spaceId: next, agentId: null, fallbackUserId: props.userId })}
          options={(spaces.data?.items ?? []).map((each) => ({ value: each.id, label: each.name }))}
        />
      </Field.Root>
      <Field.Root label="Agent" description="The agent that answers. Without one, ren answers.">
        <Select.Root
          label="Agent"
          width="full"
          placeholder="ren"
          disabled={spaceId === ""}
          value={props.draft.agentId ?? defaultAgent}
          onValueChange={(agentId) => props.onChange({ agentId: agentId === defaultAgent ? null : agentId })}
          options={[
            { value: defaultAgent, label: "ren (default)" },
            ...(agents.data?.items ?? []).map((each) => ({ value: each.id, label: each.name })),
          ]}
        />
      </Field.Root>
    </>
  )
}

function FallbackFields(props: { draft: Draft; fallback: boolean; onChange: (next: Partial<Draft>) => void }) {
  const context = RouterContext.useRouterContext()
  const spaceId = props.draft.spaceId
  const members = useQuery({
    ...Pages.all((number) => context.api["space-member"].list.queryOptions({ ...page, page: number, spaceId })),
    enabled: spaceId !== "",
  })
  return (
    <>
      <Field.Root
        label="Answer unknown senders"
        orientation="row"
        description={
          props.draft.place?.anyoneCanWrite
            ? "Anyone can write here, so this starts off. When on, people Ren can’t match to a space member run as the fallback user."
            : "People Ren can’t match to a space member run as the fallback user. When off, Ren refuses them."
        }
      >
        <Switch
          label="Answer unknown senders"
          checked={props.fallback}
          onCheckedChange={(fallback) => props.onChange({ fallback })}
        />
      </Field.Root>
      {props.fallback ? (
        <Field.Root label="Fallback user">
          <Select.Root
            label="Fallback user"
            width="full"
            disabled={spaceId === ""}
            value={props.draft.fallbackUserId}
            onValueChange={(fallbackUserId) => props.onChange({ fallbackUserId })}
            options={(members.data?.items ?? []).flatMap((each) =>
              each.status === "active" ? [{ value: each.userId, label: each.name || each.email }] : [],
            )}
          />
        </Field.Root>
      ) : null}
    </>
  )
}
