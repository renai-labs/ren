import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconChevronDown, IconPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { toast } from "@ren/ui/sonner"
import { AddRepositoriesDialog } from "../../components/add-repositories-dialog.js"
import { GitHubMark } from "../../icons/brands.js"
import { Repositories } from "../../lib/repositories.js"
import { RouterContext } from "../../lib/router-context.js"

export function RepositoriesDialog(props: { spaceId: string; onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const settings = useQuery(api["space-settings"].get.queryOptions({ idOrSlug: props.spaceId }))
  const update = useMutation(api["space-settings"].update.mutationOptions())
  const current = settings.data?.settings
  if (!current) return null
  const references = current.references ?? []
  return (
    <AddRepositoriesDialog
      existing={references}
      saving={update.isPending}
      error={update.error}
      onAdd={(added) =>
        update
          .mutateAsync({ id: props.spaceId, settings: { ...current, references: [...references, ...added] } })
          .then(() => {
            toast.success(added.length > 1 ? `${added.length} repositories added` : "Repository added")
            props.onClose()
          })
      }
      onClose={props.onClose}
    />
  )
}

export function RepositoriesPicker(props: { spaceId: string | undefined; disabled?: boolean | undefined }) {
  const { api } = RouterContext.useRouterContext()
  const [adding, setAdding] = useState(false)
  const settings = useQuery({
    ...api["space-settings"].get.queryOptions({ idOrSlug: props.spaceId ?? "" }),
    enabled: props.spaceId !== undefined,
  })
  const references = settings.data?.settings.references ?? []
  const first = references.at(0)
  if (!props.spaceId || !first) return null
  return (
    <>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={props.disabled}
          render={
            <Button
              variant="ghost"
              className="px-1 font-normal text-muted-foreground aria-expanded:bg-transparent"
              aria-label={`Repositories: ${references.map((reference) => reference.alias).join(", ")}`}
            />
          }
        >
          <GitHubMark className="size-4" />
          <span className="max-w-40 truncate text-foreground">{Repositories.nameOf(first.repository)}</span>
          {references.length > 1 ? <span className="tabular-nums">+{references.length - 1}</span> : null}
          <IconChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Repositories in this space</DropdownMenuLabel>
            {references.map((reference) => (
              <DropdownMenuItem key={reference.alias} disabled>
                <GitHubMark className="size-4" />
                <span className="min-w-0 flex-1 truncate">{Repositories.nameOf(reference.repository)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {settings.data?.canUpdate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setAdding(true)}>
                  <IconPlus />
                  Add repository
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {adding ? <RepositoriesDialog spaceId={props.spaceId} onClose={() => setAdding(false)} /> : null}
    </>
  )
}
