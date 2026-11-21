import { useState } from "react"
import type { ReferenceInfo } from "@ren/client"
import { Repositories } from "@ren/chat"
import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconAlertCircle, IconPlus } from "@tabler/icons-react"
import { Button, buttonVariants } from "@ren/ui/button"
import { Checkbox } from "@ren/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { FieldError } from "@ren/ui/field"
import { Spinner } from "@ren/ui/spinner"
import { errorMessage } from "../lib/errors.js"
import { GitHubMark } from "../icons/brands.js"
import { EmptyState } from "./empty-state.js"
import { RouterContext } from "../lib/router-context.js"

function emptyText(listed: Pick<UseQueryResult, "isPending" | "error">, available: number) {
  if (listed.isPending) return "Loading…"
  if (listed.error) return errorMessage(listed.error, "Could not list the repositories.")
  if (available === 0) return "Every repository is already in this space"
  return "No matching repositories"
}

function PastedRepository(props: {
  search: string
  pasted: Repositories.Parsed
  known: ReadonlySet<string>
  onAdd: () => void
}) {
  const problem = Repositories.problemOf(props.pasted, props.known)
  return (
    <CommandGroup className="p-0" forceMount>
      <CommandItem forceMount value={props.search} disabled={problem !== undefined} onSelect={props.onAdd}>
        {problem ? <IconAlertCircle /> : <IconPlus />}
        <span className="truncate">{problem ?? `Add ${Repositories.nameOf(props.pasted.repository)}`}</span>
        {props.pasted.branch && !problem ? (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{props.pasted.branch}</span>
        ) : null}
      </CommandItem>
    </CommandGroup>
  )
}

function ConnectGitHub() {
  return (
    <EmptyState
      action={
        <Link
          to="/settings/channels/$provider"
          params={{ provider: "github" }}
          className={buttonVariants({ variant: "outline" })}
        >
          <GitHubMark data-icon="inline-start" />
          Connect GitHub
        </Link>
      }
    >
      Paste the URL of a public GitHub repository, or connect GitHub to pick from your repositories.
    </EmptyState>
  )
}

export function AddRepositoriesDialog(props: {
  existing: ReadonlyArray<ReferenceInfo>
  saving: boolean
  error: Error | null
  onAdd: (added: ReadonlyArray<ReferenceInfo>) => Promise<void>
  onClose: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const listed = useQuery(api.repository.list.queryOptions())
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState<ReadonlyMap<string, Repositories.Picked>>(() => new Map())
  const known = Repositories.knownOf(props.existing)
  const repositories = Repositories.candidates(listed.data ?? [], known)
  const rows = Repositories.rows(repositories, picked)
  const pasted = Repositories.parse(search)
  const connected = listed.data?.some((listing) => listing.installed) ?? true
  const add = () => props.onAdd(Repositories.referencesOf(picked, props.existing))
  return (
    <Dialog open onOpenChange={(open) => (open || props.saving ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add repositories</DialogTitle>
          <DialogDescription>{Repositories.copy}</DialogDescription>
        </DialogHeader>
        <Command className="rounded-none bg-transparent p-0 **:data-[slot=command-input-wrapper]:mx-0 **:data-[slot=command-input-wrapper]:mt-0">
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search or paste https://github.com/owner/repo"
          />
          <CommandList className="pt-1">
            <CommandEmpty>{connected ? emptyText(listed, repositories.length) : <ConnectGitHub />}</CommandEmpty>
            {pasted ? (
              <PastedRepository
                search={search}
                pasted={pasted}
                known={known}
                onAdd={() => {
                  setPicked((current) => Repositories.paste(current, pasted, repositories))
                  setSearch("")
                }}
              />
            ) : null}
            {!pasted && rows.length > 0 ? (
              <CommandGroup className="p-0">
                {rows.map((row) => (
                  <CommandItem
                    key={row.key}
                    value={row.name}
                    keywords={[row.picked.parsed.repository]}
                    onSelect={() => setPicked((current) => Repositories.toggle(current, row.key, row.picked))}
                  >
                    <Checkbox checked={picked.has(row.key)} tabIndex={-1} aria-hidden className="pointer-events-none" />
                    <GitHubMark className="size-4 shrink-0" />
                    <span className="truncate">{row.name}</span>
                    {row.picked.parsed.branch ? (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {row.picked.parsed.branch}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
        {props.error ? <FieldError>{errorMessage(props.error)}</FieldError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={props.saving}>
            Cancel
          </DialogClose>
          <Button disabled={picked.size === 0 || props.saving} onClick={() => void add().catch(() => undefined)}>
            {props.saving ? <Spinner data-icon="inline-start" /> : null}
            {picked.size > 1 ? `Add ${picked.size} repositories` : "Add repository"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
