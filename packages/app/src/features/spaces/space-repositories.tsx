import { useState } from "react"
import type { ReferenceInfo } from "@ren/client"
import { Reference } from "@ren/schema/reference"
import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { IconGitBranch, IconPlus } from "@tabler/icons-react"
import { Schema } from "effect"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { ExpandableSearch } from "../../components/expandable-search.js"
import { ListPagination } from "../../components/list-pagination.js"
import { TableCard, TableEmpty } from "../../components/page.js"
import { AddRepositoriesDialog } from "../../components/add-repositories-dialog.js"
import { RowMenu } from "../../components/row-menu.js"
import { errorMessage } from "../../lib/errors.js"
import { pageSize, currentPage, pageCount } from "../../lib/pagination.js"
import { formText } from "../../lib/format.js"
import { Repositories } from "../../lib/repositories.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

const isAlias = Schema.is(Reference.Alias)

const isBranch = Schema.is(Reference.Branch)

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/repositories")

function RepositoryName(props: { reference: ReferenceInfo }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <IconGitBranch className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate" title={props.reference.repository}>
        {Repositories.nameOf(props.reference.repository)}
      </span>
      {props.reference.branch ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{props.reference.branch}</span>
      ) : null}
    </span>
  )
}

function problemOf(next: ReferenceInfo) {
  if (!isAlias(next.alias)) return "alias"
  if (next.branch && !isBranch(next.branch)) return "branch"
  return
}

export function SpaceRepositoriesTab() {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const params = route.useParams()
  const search = route.useSearch()
  const settings = useSuspenseQuery(api["space-settings"].get.queryOptions({ idOrSlug: params.spaceId })).data
  const update = useMutation(api["space-settings"].update.mutationOptions())
  const [query, setQuery] = useState("")
  const [dialog, setDialog] = useState<"add" | ReferenceInfo>()
  const references = settings.settings.references ?? []
  const needle = query.trim().toLowerCase()
  const matching = references.filter((reference) =>
    [reference.alias, reference.repository, reference.description, reference.branch ?? ""].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  )
  const page = Math.min(currentPage(search), pageCount(matching.length, pageSize))
  const save = (next: ReadonlyArray<ReferenceInfo>) =>
    update.mutateAsync({ id: space.id, settings: { ...settings.settings, references: [...next] } })
  const canUpdate = settings.canUpdate
  const total = matching.length
  const visible = matching.slice((page - 1) * pageSize, page * pageSize)
  const open = (next?: "add" | ReferenceInfo) => {
    update.reset()
    setDialog(next)
  }
  const saving = update.isPending
  const error = update.error
  const add = (added: ReadonlyArray<ReferenceInfo>) =>
    save([...references, ...added]).then(() => {
      toast.success(added.length > 1 ? `${added.length} repositories added` : "Repository added")
      setDialog(undefined)
    })
  const edit = (previous: ReferenceInfo, next: ReferenceInfo) =>
    save(references.map((each) => (each.alias === previous.alias ? next : each))).then(() => setDialog(undefined))
  const remove = (reference: ReferenceInfo) =>
    save(references.filter((each) => each.alias !== reference.alias)).then(
      () => toast.success(`${Repositories.nameOf(reference.repository)} removed`),
      (error: unknown) => toast.error("Could not remove the repository", { description: errorMessage(error) }),
    )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-1">
        <ExpandableSearch label="Search repositories" value={query} onChange={setQuery} />
        {canUpdate ? (
          <Button onClick={() => open("add")}>
            <IconPlus data-icon="inline-start" />
            Add repositories
          </Button>
        ) : null}
      </div>
      <TableCard>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Repository</TableHead>
              <TableHead className="w-2/5">Description</TableHead>
              {canUpdate ? <TableHead className="w-15" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableEmpty columns={3}>
                {query.trim()
                  ? `Nothing matches “${query.trim()}”`
                  : "No repositories yet. Add one so Ren can read it."}
              </TableEmpty>
            ) : null}
            {visible.map((reference) => (
              <TableRow key={reference.alias}>
                <TableCell>
                  <RepositoryName reference={reference} />
                </TableCell>
                <TableCell className="truncate text-muted-foreground" title={reference.description}>
                  {reference.description}
                </TableCell>
                {canUpdate ? (
                  <TableCell>
                    <RowMenu
                      label={`${Repositories.nameOf(reference.repository)} actions`}
                      items={[
                        { label: "Edit", onSelect: () => open(reference) },
                        {
                          label: "Remove",
                          onSelect: () => remove(reference),
                          confirm: {
                            title: `Remove ${Repositories.nameOf(reference.repository)}?`,
                            description: "Chats in this space stop reading it.",
                            action: "Remove",
                          },
                        },
                      ]}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <div className="flex items-center justify-between gap-4 empty:hidden">
        <ListPagination page={page} pageSize={pageSize} total={total} noun="repository" />
      </div>
      {dialog === "add" ? (
        <AddRepositoriesDialog existing={references} saving={saving} error={error} onAdd={add} onClose={() => open()} />
      ) : null}
      {dialog && dialog !== "add" ? (
        <EditRepositoryDialog reference={dialog} saving={saving} error={error} onSave={edit} onClose={() => open()} />
      ) : null}
    </div>
  )
}

function EditRepositoryDialog(props: {
  reference: ReferenceInfo
  saving: boolean
  error: Error | null
  onSave: (previous: ReferenceInfo, next: ReferenceInfo) => Promise<void>
  onClose: () => void
}) {
  const name = Repositories.nameOf(props.reference.repository)
  const [invalid, setInvalid] = useState<"alias" | "branch">()
  return (
    <Dialog open onOpenChange={(open) => (open || props.saving ? undefined : props.onClose())}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const next = Repositories.infoOf({
              repository: props.reference.repository,
              alias: formText(form, "alias"),
              branch: formText(form, "branch"),
              description: formText(form, "description"),
            })
            const problem = problemOf(next)
            setInvalid(problem)
            if (!problem) void props.onSave(props.reference, next).catch(() => undefined)
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit {name}</DialogTitle>
            <DialogDescription>{Repositories.copy}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field data-invalid={invalid === "alias" || undefined}>
              <FieldLabel htmlFor="repository-alias">Alias</FieldLabel>
              <Input
                id="repository-alias"
                name="alias"
                required
                aria-invalid={invalid === "alias" || undefined}
                defaultValue={props.reference.alias}
              />
              {invalid === "alias" ? (
                <FieldError>An alias has no slash, backslash, space, backtick or comma.</FieldError>
              ) : null}
            </Field>
            <Field data-invalid={invalid === "branch" || undefined}>
              <FieldLabel htmlFor="repository-branch">Branch</FieldLabel>
              <Input
                id="repository-branch"
                name="branch"
                placeholder="Default branch"
                className="font-mono"
                aria-invalid={invalid === "branch" || undefined}
                defaultValue={props.reference.branch ?? ""}
              />
              {invalid === "branch" ? <FieldError>Use a valid git branch name.</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="repository-description">Description</FieldLabel>
              <Input
                id="repository-description"
                name="description"
                required
                placeholder="Product docs and style guide"
                defaultValue={props.reference.description}
              />
            </Field>
          </FieldGroup>
          {props.error ? <FieldError>{errorMessage(props.error)}</FieldError> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />} disabled={props.saving}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={props.saving}>
              {props.saving ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
