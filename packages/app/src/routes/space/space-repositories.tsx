import { useState } from "react"
import type { ReferenceInfo } from "@ren/client"
import { Reference } from "@ren/schema/reference"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { IconBrandGithub, IconGitBranch, IconPlus } from "@tabler/icons-react"
import { Schema } from "effect"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ren/empty-state"
import { ExpandableSearch } from "@/components/ren/expandable-search"
import { ListPagination } from "@/components/ren/list-pagination"
import { TableCard, TableEmpty } from "@/components/ren/page"
import { RowMenu } from "@/components/ren/row-menu"
import { api, errorMessage, pageSize } from "@/lib/api"
import { formText } from "@/lib/format"
import { currentPage, pageCount } from "@/lib/pagination"
import { Repositories } from "@/lib/repositories"
import { useSpace } from "@/routes/space/use-space"

const isAlias = Schema.is(Reference.Alias)

const isBranch = Schema.is(Reference.Branch)

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/repositories")

function useSpaceRepositories() {
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
  return {
    canUpdate: settings.canUpdate,
    references,
    page,
    total: matching.length,
    visible: matching.slice((page - 1) * pageSize, page * pageSize),
    query,
    setQuery,
    dialog,
    open: (next?: "add" | ReferenceInfo) => {
      update.reset()
      setDialog(next)
    },
    saving: update.isPending,
    error: update.error,
    add: (added: ReadonlyArray<ReferenceInfo>) =>
      save([...references, ...added]).then(() => {
        toast.success(added.length > 1 ? `${added.length} repositories added` : "Repository added")
        setDialog(undefined)
      }),
    edit: (previous: ReferenceInfo, next: ReferenceInfo) =>
      save(references.map((each) => (each.alias === previous.alias ? next : each))).then(() => setDialog(undefined)),
    remove: (reference: ReferenceInfo) =>
      save(references.filter((each) => each.alias !== reference.alias)).then(
        () => toast.success(`${Repositories.nameOf(reference.repository)} removed`),
        (error: unknown) => toast.error("Could not remove the repository", { description: errorMessage(error) }),
      ),
  }
}

export function SpaceRepositoriesTab() {
  const page = useSpaceRepositories()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-1">
        <ExpandableSearch label="Search repositories" value={page.query} onChange={page.setQuery} />
        {page.canUpdate ? (
          <Button size="sm" onClick={() => page.open("add")}>
            <IconPlus data-icon="inline-start" />
            Add repositories
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{Repositories.tabCopy}</p>
      <TableCard>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Repository</TableHead>
              <TableHead className="w-2/5">Description</TableHead>
              {page.canUpdate ? <TableHead className="w-15" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.visible.length === 0 ? (
              <TableEmpty columns={3}>
                {page.query.trim()
                  ? `Nothing matches “${page.query.trim()}”`
                  : "No repositories yet. Add one so Ren can read it."}
              </TableEmpty>
            ) : null}
            {page.visible.map((reference) => (
              <TableRow key={reference.alias}>
                <TableCell>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <IconGitBranch className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate" title={reference.repository}>
                      {Repositories.nameOf(reference.repository)}
                    </span>
                    {reference.branch ? (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{reference.branch}</span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="truncate text-muted-foreground" title={reference.description}>
                  {reference.description}
                </TableCell>
                {page.canUpdate ? (
                  <TableCell>
                    <RowMenu
                      label={`${Repositories.nameOf(reference.repository)} actions`}
                      items={[
                        { label: "Edit", onSelect: () => page.open(reference) },
                        {
                          label: "Remove",
                          onSelect: () => page.remove(reference),
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
        <ListPagination page={page.page} pageSize={pageSize} total={page.total} noun="repository" />
      </div>
      {page.dialog === "add" ? (
        <AddRepositoriesDialog
          existing={page.references}
          saving={page.saving}
          error={page.error}
          onAdd={page.add}
          onClose={() => page.open()}
        />
      ) : page.dialog ? (
        <EditRepositoryDialog
          reference={page.dialog}
          saving={page.saving}
          error={page.error}
          onSave={page.edit}
          onClose={() => page.open()}
        />
      ) : null}
    </div>
  )
}

function AddRepositoriesDialog(props: {
  existing: ReadonlyArray<ReferenceInfo>
  saving: boolean
  error: Error | null
  onAdd: (added: ReadonlyArray<ReferenceInfo>) => Promise<void>
  onClose: () => void
}) {
  const listed = useQuery(api.repository.list.queryOptions())
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const known = new Set(props.existing.map((reference) => reference.repository))
  const repositories = (listed.data ?? [])
    .flatMap((listing) => listing.repositories)
    .flatMap((repository) => {
      const parsed = Repositories.parse(repository.url)
      return parsed && !known.has(parsed.repository) ? [{ ...repository, parsed }] : []
    })
  const chosen = repositories.filter((repository) => picked.has(repository.url))
  const connected = listed.data?.some((listing) => listing.installed) ?? true
  const add = () =>
    props.onAdd(
      chosen.reduce<ReferenceInfo[]>((added, repository) => {
        added.push(
          Repositories.infoOf({
            repository: repository.parsed.repository,
            alias: Repositories.aliasFor(repository.parsed.name, [
              ...props.existing.map((reference) => reference.alias),
              ...added.map((reference) => reference.alias),
            ]),
            branch: repository.parsed.branch ?? "",
            description: repository.description || repository.name,
          }),
        )
        return added
      }, []),
    )
  return (
    <Dialog open onOpenChange={(open) => (open || props.saving ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add repositories</DialogTitle>
          <DialogDescription>{Repositories.copy}</DialogDescription>
        </DialogHeader>
        {connected ? (
          <Command className="rounded-lg! bg-muted inset-ring inset-ring-border **:data-[slot=input-group]:h-8.75!">
            <CommandInput placeholder="Search repositories…" />
            <CommandList className="pt-1">
              <CommandEmpty>
                {listed.isPending
                  ? "Loading…"
                  : listed.error
                    ? errorMessage(listed.error, "Could not list the repositories.")
                    : repositories.length === 0
                      ? "Every repository is already in this space"
                      : "No matching repositories"}
              </CommandEmpty>
              {repositories.length > 0 ? (
                <CommandGroup className="p-0">
                  {repositories.map((repository) => (
                    <CommandItem
                      key={repository.url}
                      value={repository.name}
                      keywords={[repository.url]}
                      onSelect={() =>
                        setPicked((current) =>
                          current.has(repository.url)
                            ? new Set([...current].filter((url) => url !== repository.url))
                            : new Set([...current, repository.url]),
                        )
                      }
                    >
                      <Checkbox
                        checked={picked.has(repository.url)}
                        tabIndex={-1}
                        aria-hidden
                        className="pointer-events-none"
                      />
                      <span className="truncate">{repository.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        ) : (
          <EmptyState
            action={
              <Button
                variant="outline"
                nativeButton={false}
                render={<a href={`${import.meta.env.BASE_URL}settings/channels/github`} aria-label="Connect GitHub" />}
              >
                <IconBrandGithub data-icon="inline-start" />
                Connect GitHub
              </Button>
            }
          >
            Connect GitHub to pick from your repositories.
          </EmptyState>
        )}
        {props.error ? <FieldError>{errorMessage(props.error)}</FieldError> : null}
        <DialogFooter className={connected ? undefined : "sm:justify-end"}>
          <DialogClose render={<Button variant="outline" />} disabled={props.saving}>
            Cancel
          </DialogClose>
          {connected ? (
            <Button disabled={chosen.length === 0 || props.saving} onClick={() => void add().catch(() => undefined)}>
              {props.saving ? <Spinner data-icon="inline-start" /> : null}
              {chosen.length > 1 ? `Add ${chosen.length} repositories` : "Add repository"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            const problem = isAlias(next.alias)
              ? next.branch && !isBranch(next.branch)
                ? "branch"
                : undefined
              : "alias"
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
