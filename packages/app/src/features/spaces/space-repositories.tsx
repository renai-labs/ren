import type { ReferenceInfo, SettingsInfo } from "@ren/client"
import { Reference } from "@ren/schema/reference"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { CopyButton } from "@ren/ui/copy-button"
import { Dialog } from "@ren/ui/dialog"
import { Field } from "@ren/ui/field"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"
import { Notice } from "@ren/ui/notice"
import { Pagination } from "@ren/ui/pagination"
import { SearchField } from "@ren/ui/search-field"
import { Table } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { TextField } from "@ren/ui/text-field"
import { Toast } from "@ren/ui/toast"
import { Toolbar } from "@ren/ui/toolbar"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Schema } from "effect"
import { useDeferredValue, useState } from "react"
import type { ReactNode } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { SpaceAddRepositories } from "./add-repositories-dialog.js"
import { Repositories } from "./repositories.js"

const pageSize = 20

const isAlias = Schema.is(Reference.Alias)

const matches = (reference: ReferenceInfo, needle: string) =>
  [reference.alias, reference.repository, reference.description, reference.branch ?? ""].some((text) =>
    text.toLowerCase().includes(needle.toLowerCase()),
  )

function useSave(spaceId: string, settings: SettingsInfo | undefined) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const update = useMutation(context.api["space-settings"].update.mutationOptions())
  return async (references: ReadonlyArray<ReferenceInfo>) => {
    if (!settings) return
    await update.mutateAsync({ id: spaceId, settings: { ...settings, references: [...references] } })
    await queryClient.invalidateQueries({ queryKey: context.api["space-settings"].get.queryKey() })
  }
}

// oxlint-disable-next-line ren/no-comments -- §5a: the references of the space settings only (R22), called repositories (R27). A person who cannot update the settings sees the list without Add and without the row menu.
export function SpaceRepositories(props: { spaceId: string }) {
  const context = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const settings = useQuery(context.api["space-settings"].get.queryOptions({ idOrSlug: props.spaceId }))
  const save = useSave(props.spaceId, settings.data?.settings)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ReferenceInfo>()
  const [removing, setRemoving] = useState<ReferenceInfo>()
  const needle = useDeferredValue(query.trim())
  const references = settings.data?.settings.references ?? []
  const visible = Repositories.page(
    references.filter((reference) => matches(reference, needle)),
    page,
    pageSize,
  )
  const canUpdate = settings.data?.canUpdate === true
  const state = { pending: "loading", error: "failed", success: visible.total > 0 ? "ready" : "empty" } as const
  return (
    <>
      <Toolbar.Root>
        <SearchField.Expandable
          value={query}
          onValueChange={(next) => {
            setQuery(next)
            setPage(1)
          }}
          placeholder="Search repositories"
        />
        {canUpdate ? (
          <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />} onClick={() => setAdding(true)}>
            Add repositories
          </Button>
        ) : null}
      </Toolbar.Root>
      <Text purpose="body" tone="secondary">
        {Repositories.tabCopy}
      </Text>
      <Table.Root
        state={state[settings.status]}
        failureMessage="Couldn’t load the repositories of this space."
        emptyMessage={needle ? `Nothing matches “${needle}”` : "No repositories yet. Add one so Ren can read it."}
        caption="Repositories"
      >
        <Table.Header>
          <Table.HeaderCell width="third">Name</Table.HeaderCell>
          <Table.HeaderCell width="fill">Repository</Table.HeaderCell>
          {canUpdate ? <Table.RowActionsHeaderCell /> : null}
        </Table.Header>
        <Table.Body>
          {visible.items.map((reference) => (
            <RepositoryRow
              key={reference.alias}
              reference={reference}
              copy={platform.writeClipboardText}
              actions={
                canUpdate ? (
                  <Table.RowActions label={`${reference.alias} actions`}>
                    <Menu.Item icon={<Icon glyph="Pencil" />} onSelect={() => setEditing(reference)}>
                      Edit
                    </Menu.Item>
                    <Menu.Item tone="danger" icon={<Icon glyph="Trash2" />} onSelect={() => setRemoving(reference)}>
                      Remove
                    </Menu.Item>
                  </Table.RowActions>
                ) : null
              }
            />
          ))}
        </Table.Body>
      </Table.Root>
      <Pagination.Numbered page={visible.page} pageCount={visible.pageCount} onPageChange={setPage} />
      {adding ? <SpaceAddRepositories spaceId={props.spaceId} onClose={() => setAdding(false)} /> : null}
      {editing ? (
        <EditRepositoryDialog
          reference={editing}
          others={references.filter((each) => each.alias !== editing.alias)}
          onSave={(next) => save(references.map((each) => (each.alias === editing.alias ? next : each)))}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      {removing ? (
        <RemoveRepositoryDialog
          reference={removing}
          onRemove={() => save(references.filter((each) => each.alias !== removing.alias))}
          onClose={() => setRemoving(undefined)}
        />
      ) : null}
    </>
  )
}

function RemoveRepositoryDialog(props: {
  reference: ReferenceInfo
  onRemove: () => Promise<void>
  onClose: () => void
}) {
  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={`Remove ${props.reference.alias}?`}
      description="Chats in this space stop reading it."
      confirmLabel="Remove"
      tone="danger"
      onConfirm={props.onRemove}
      onConfirmed={() => {
        Toast.manager.add({ type: "success", title: `${props.reference.alias} removed` })
        props.onClose()
      }}
    />
  )
}

function RepositoryRow(props: {
  reference: ReferenceInfo
  copy: ((text: string) => Promise<void>) | undefined
  actions: ReactNode
}) {
  const reference = props.reference
  return (
    <Table.Row>
      <Table.Cell>
        <span className="flex min-w-0 flex-col">
          <Text truncation="single-line" element="span">
            {reference.alias}
          </Text>
          <Text purpose="caption" tone="secondary" truncation="single-line" element="span">
            {reference.description}
          </Text>
        </span>
      </Table.Cell>
      <Table.Cell>
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-col">
            <Text truncation="single-line" element="span" title={reference.repository}>
              {Repositories.nameOf(reference.repository)}
            </Text>
            <Text purpose="caption" tone="secondary" element="span">
              {reference.branch ?? "default branch"}
            </Text>
          </span>
          {props.copy ? (
            <CopyButton
              value={reference.repository}
              onCopy={props.copy}
              label={`Copy the address of ${reference.alias}`}
              size="extra-small"
            />
          ) : null}
        </span>
      </Table.Cell>
      {props.actions}
    </Table.Row>
  )
}

const aliasProblem = (alias: string, others: ReadonlyArray<ReferenceInfo>) => {
  if (!isAlias(alias)) return "Use an alias with no slash, backslash, space, backtick or comma."
  return others.some((each) => each.alias === alias) ? `Another repository uses the alias ${alias}.` : undefined
}

// oxlint-disable-next-line ren/no-comments -- §5a Edit dialog: the address is cleaned as a pasted one, an empty branch is the default branch, and Ren checks a new address as at Add (R13, R26).
function EditRepositoryDialog(props: {
  reference: ReferenceInfo
  others: ReadonlyArray<ReferenceInfo>
  onSave: (next: ReferenceInfo) => Promise<void>
  onClose: () => void
}) {
  const [repository, setRepository] = useState(props.reference.repository)
  const [alias, setAlias] = useState(props.reference.alias)
  const [branch, setBranch] = useState(props.reference.branch ?? "")
  const [description, setDescription] = useState(props.reference.description)
  const [checked, setChecked] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [saving, setSaving] = useState(false)
  const parsed = Repositories.parse(repository)
  const problems = {
    repository: parsed ? undefined : "Paste a repository address, like https://github.com/acme/docs.",
    alias: aliasProblem(alias.trim(), props.others),
    description: description.trim() ? undefined : "Description is required.",
  }
  const submit = async () => {
    setChecked(true)
    setFailure(undefined)
    if (!parsed || problems.alias || problems.description) return
    setSaving(true)
    await props
      .onSave(
        Repositories.infoOf({
          repository: parsed.repository,
          alias,
          branch: branch.trim() || (parsed.branch ?? ""),
          description,
        }),
      )
      .then(props.onClose)
      .catch((error: unknown) => setFailure(Repositories.refusal(error).message))
    setSaving(false)
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={saving ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Edit {props.reference.alias}</Dialog.Title>
          <Dialog.Description>{Repositories.copy}</Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Field.Root label="Repository URL" error={checked ? problems.repository : undefined}>
            <TextField
              type="url"
              value={repository}
              invalid={checked && problems.repository !== undefined}
              onChange={(event) => setRepository(event.target.value)}
              onBlur={() => {
                if (!parsed) return
                setRepository(parsed.repository)
                if (parsed.branch) setBranch(parsed.branch)
              }}
            />
          </Field.Root>
          <Field.Root label="Alias" error={checked ? problems.alias : undefined}>
            <TextField value={alias} onChange={(event) => setAlias(event.target.value)} />
          </Field.Root>
          <Field.Root label="Branch" necessity="optional">
            <TextField placeholder="default" value={branch} onChange={(event) => setBranch(event.target.value)} />
          </Field.Root>
          <Field.Root label="Description" error={checked ? problems.description : undefined}>
            <TextField
              placeholder="Product docs and style guide"
              value={description}
              invalid={checked && problems.description !== undefined}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field.Root>
          <Notice tone="danger" placement="inline">
            {failure}
          </Notice>
        </Dialog.Body>
        <Dialog.Footer>
          <FormActions.Root>
            <FormActions.Cancel onClick={props.onClose} disabled={saving} />
            <FormActions.Submit pending={saving} pendingLabel="Saving…" onClick={() => void submit()}>
              Save repository
            </FormActions.Submit>
          </FormActions.Root>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
