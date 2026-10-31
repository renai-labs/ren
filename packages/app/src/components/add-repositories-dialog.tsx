import { useState } from "react"
import type { ReferenceInfo } from "@ren/client"
import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconBrandGithub } from "@tabler/icons-react"
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
import { Repositories } from "../lib/repositories.js"
import { EmptyState } from "./empty-state.js"
import { RouterContext } from "../lib/router-context.js"

function emptyText(listed: Pick<UseQueryResult, "isPending" | "error">, available: number) {
  if (listed.isPending) return "Loading…"
  if (listed.error) return errorMessage(listed.error, "Could not list the repositories.")
  if (available === 0) return "Every repository is already in this space"
  return "No matching repositories"
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
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
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
          <Command className="rounded-lg bg-muted inset-ring inset-ring-border **:data-[slot=input-group]:h-8.75">
            <CommandInput placeholder="Search repositories…" />
            <CommandList className="pt-1">
              <CommandEmpty>{emptyText(listed, repositories.length)}</CommandEmpty>
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
              <Link
                to="/settings/channels/$provider"
                params={{ provider: "github" }}
                className={buttonVariants({ variant: "outline" })}
              >
                <IconBrandGithub data-icon="inline-start" />
                Connect GitHub
              </Link>
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
