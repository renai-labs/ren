import type { ReferenceInfo, SettingsInfo } from "@ren/client"
import { Reference } from "@ren/schema/reference"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { CopyButton } from "@ren/ui/copy-button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Field, FieldError, FieldLabel } from "@ren/ui/field"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import { Input } from "@ren/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@ren/ui/pagination"
import { SearchField } from "@ren/ui/search-field"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { toast } from "@ren/ui/toast"
import { Page } from "@ren/ui/page"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Schema } from "effect"
import { Fragment, useDeferredValue, useId, useState } from "react"
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
  const update = useMutation(context.api["space-settings"].update.mutationOptions())
  return async (references: ReadonlyArray<ReferenceInfo>) => {
    if (!settings) return
    await update.mutateAsync({ id: spaceId, settings: { ...settings, references: [...references] } })
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
  const canUpdate = settings.data?.canUpdate
  const state = { pending: "loading", error: "failed", success: visible.total > 0 ? "ready" : "empty" } as const
  const status = state[settings.status]
  return (
    <>
      <Page.Toolbar
        actions={
          <>
            <SearchField.Expandable
              value={query}
              onValueChange={(next) => {
                setQuery(next)
                setPage(1)
              }}
              placeholder="Search repositories"
            />
            {canUpdate === false ? null : (
              <Button size="sm" disabled={canUpdate === undefined} onClick={() => setAdding(true)}>
                <Icon glyph="Plus" data-icon="inline-start" />
                Add repositories
              </Button>
            )}
          </>
        }
      />
      <Text purpose="body" tone="secondary">
        {Repositories.tabCopy}
      </Text>
      <RepositoriesTable
        state={status}
        emptyMessage={needle ? `Nothing matches “${needle}”` : "No repositories yet. Add one so Ren can read it."}
        columns={
          <>
            <TableHead className="w-1/3">Name</TableHead>
            <TableHead>Repository</TableHead>
            {canUpdate ? (
              <TableHead className="w-15">
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </>
        }
      >
        {visible.items.map((reference) => (
          <RepositoryRow
            key={reference.alias}
            reference={reference}
            copy={platform.writeClipboardText}
            actions={
              canUpdate ? (
                <TableCell>
                  <RepositoryActions
                    alias={reference.alias}
                    onEdit={() => setEditing(reference)}
                    onRemove={() => setRemoving(reference)}
                  />
                </TableCell>
              ) : null
            }
          />
        ))}
      </RepositoriesTable>
      <RepositoriesPagination page={visible.page} pageCount={visible.pageCount} onPageChange={setPage} />
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

function RepositoriesTable(props: {
  state: "loading" | "failed" | "ready" | "empty"
  emptyMessage: string
  columns: ReactNode
  children: ReactNode
}) {
  return (
    <Page.TableCard>
      <Table className="table-fixed">
        <TableCaption className="sr-only">Repositories</TableCaption>
        <TableHeader>
          <TableRow>{props.columns}</TableRow>
        </TableHeader>
        <TableBody>
          <Page.TableState
            state={props.state}
            columns={3}
            failureMessage="Couldn’t load the repositories of this space."
            emptyMessage={props.emptyMessage}
          />
          {props.children}
        </TableBody>
      </Table>
    </Page.TableCard>
  )
}

function RepositoryActions(props: { alias: string; onEdit: () => void; onRemove: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="-my-1 flex text-muted-foreground"
            aria-label={`${props.alias} actions`}
          />
        }
      >
        <Icon glyph="MoreHorizontal" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={props.onEdit}>
            <Icon glyph="Pencil" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={props.onRemove}>
            <Icon glyph="Trash2" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RepositoriesPagination(props: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  if (props.pageCount <= 1) return null
  const shown =
    props.pageCount <= 7
      ? Array.from({ length: props.pageCount }, (_, index) => index + 1)
      : [...new Set([1, props.pageCount, props.page - 1, props.page, props.page + 1])]
          .filter((value) => value >= 1 && value <= props.pageCount)
          .toSorted((a, b) => a - b)
  return (
    <Pagination className="justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            aria-label="Previous page"
            aria-disabled={props.page <= 1}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            onClick={() => props.onPageChange(props.page - 1)}
          />
        </PaginationItem>
        {shown.map((value, index) => (
          <Fragment key={value}>
            {value - (shown[index - 1] ?? value - 1) > 1 ? (
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
            ) : null}
            <PaginationItem>
              <PaginationLink isActive={value === props.page} onClick={() => props.onPageChange(value)}>
                {value}
              </PaginationLink>
            </PaginationItem>
          </Fragment>
        ))}
        <PaginationItem>
          <PaginationNext
            aria-label="Next page"
            aria-disabled={props.page >= props.pageCount}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            onClick={() => props.onPageChange(props.page + 1)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
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
        toast.add({ type: "success", title: `${props.reference.alias} removed` })
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
    <TableRow>
      <TableCell>
        <span className="flex min-w-0 flex-col">
          <Text truncation="single-line" element="span">
            {reference.alias}
          </Text>
          <Text purpose="caption" tone="secondary" truncation="single-line" element="span">
            {reference.description}
          </Text>
        </span>
      </TableCell>
      <TableCell>
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
      </TableCell>
      {props.actions}
    </TableRow>
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
  const id = useId()
  const parsed = Repositories.parse(repository)
  const problems = {
    repository: parsed ? undefined : "Paste a repository address, like https://github.com/acme/docs.",
    alias: aliasProblem(alias.trim(), props.others),
    description: description.trim() ? undefined : "Description is required.",
  }
  const shown = checked ? problems : { repository: undefined, alias: undefined, description: undefined }
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {props.reference.alias}</DialogTitle>
          <DialogDescription>{Repositories.copy}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field data-invalid={shown.repository !== undefined}>
            <FieldLabel htmlFor={`${id}-repository`}>Repository URL</FieldLabel>
            <Input
              id={`${id}-repository`}
              type="url"
              value={repository}
              aria-invalid={shown.repository !== undefined}
              onChange={(event) => setRepository(event.target.value)}
              onBlur={() => {
                if (!parsed) return
                setRepository(parsed.repository)
                if (parsed.branch) setBranch(parsed.branch)
              }}
            />
            <FieldError>{shown.repository}</FieldError>
          </Field>
          <Field data-invalid={shown.alias !== undefined}>
            <FieldLabel htmlFor={`${id}-alias`}>Alias</FieldLabel>
            <Input
              id={`${id}-alias`}
              value={alias}
              aria-invalid={shown.alias !== undefined}
              onChange={(event) => setAlias(event.target.value)}
            />
            <FieldError>{shown.alias}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-branch`}>
              Branch
              <span className="font-normal text-muted-foreground">Optional</span>
            </FieldLabel>
            <Input
              id={`${id}-branch`}
              placeholder="default"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            />
          </Field>
          <Field data-invalid={shown.description !== undefined}>
            <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
            <Input
              id={`${id}-description`}
              placeholder="Product docs and style guide"
              value={description}
              aria-invalid={shown.description !== undefined}
              onChange={(event) => setDescription(event.target.value)}
            />
            <FieldError>{shown.description}</FieldError>
          </Field>
          {failure ? (
            <Alert variant="destructive">
              <Icon glyph="AlertCircle" />
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter className="sm:justify-end">
          <FormActions.Root>
            <FormActions.Cancel onClick={props.onClose} disabled={saving} />
            <FormActions.Submit pending={saving} pendingLabel="Saving…" onClick={() => void submit()}>
              Save repository
            </FormActions.Submit>
          </FormActions.Root>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
