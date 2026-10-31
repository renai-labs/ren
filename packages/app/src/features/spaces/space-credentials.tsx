import { useState } from "react"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { IconChevronDown, IconCopy, IconPlus } from "@tabler/icons-react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { CredentialSheet } from "../../components/credential-sheet.js"
import { CredentialsTable } from "../../components/credentials-table.js"
import { ListPagination } from "../../components/list-pagination.js"
import { Row, Rows, SkeletonRows } from "../../components/page.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { useMe } from "../../lib/use-me.js"
import { useDebouncedValue } from "../../lib/use-debounced-value.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { errorMessage } from "../../lib/errors.js"
import { pageSize, pickerPageSize, currentPage, lastPageAfterRemoval } from "../../lib/pagination.js"
import { canCopy, ownerLabel } from "../../lib/apps.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/credentials")

export function SpaceCredentialsTab() {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const me = useMe()
  const spaces = useSpaces().spaces
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const page = currentPage(search)
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const [adding, setAdding] = useState(false)
  const [copying, setCopying] = useState(false)
  const keys = useQuery({
    ...api.credential.list.queryOptions({
      owner: "space",
      spaceId: space.id,
      page,
      pageSize,
      ...(needle && { search: needle }),
    }),
    placeholderData: keepPreviousData,

    ...Loader.required,
  })
  const others = useQuery(api.credential.list.queryOptions({ owner: "space", page: 1, pageSize: pickerPageSize }))
  const copy = useMutation(api.credential.copy.mutationOptions())
  const here = keys.data?.items ?? []
  const elsewhere = (others.data?.items ?? []).filter(
    (credential) =>
      credential.owner.kind === "space" &&
      credential.owner.spaceId !== space.id &&
      canCopy(credential) &&
      !here.some((each) => each.label === credential.label),
  )
  const total = keys.data?.total ?? 0
  const loading = keys.isPending
  const stale = keys.isPlaceholderData
  const removed = () => {
    const next = lastPageAfterRemoval(page, total, pageSize)
    if (next !== page) void navigate({ search: (previous) => ({ ...previous, page: next }) })
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-1">
        <ToolbarSearch label="Search keys" value={query} onChange={setQuery} />
        {elsewhere.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button />}>
              <IconPlus />
              Add key
              <IconChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setAdding(true)}>
                  <IconPlus />
                  Add key
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCopying(true)}>
                  <IconCopy />
                  Copy from a space
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button onClick={() => setAdding(true)}>
            <IconPlus />
            Add key
          </Button>
        )}
      </div>
      {loading ? (
        <SkeletonRows count={3} />
      ) : (
        <CredentialsTable
          credentials={here}
          stale={stale}
          onRemoved={removed}
          empty={query ? `Nothing matches “${query.trim()}”` : "No keys"}
        />
      )}
      <div className="flex items-center justify-between gap-4 empty:hidden">
        <ListPagination page={page} pageSize={pageSize} total={total} noun="key" />
      </div>
      <CredentialSheet
        open={adding}
        onOpenChange={setAdding}
        title="Add key to this space"
        description="Every chat in this space can use it."
        owners={[{ value: `space:${space.id}`, label: space.name }]}
        userId={me.user.id}
      />
      <Dialog open={copying} onOpenChange={setCopying}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy from a space</DialogTitle>
            <DialogDescription>
              A copy is a separate pasted key. Sign-ins cannot be copied; move them instead.
            </DialogDescription>
          </DialogHeader>
          <Rows>
            {elsewhere.map((credential) => (
              <Row
                key={credential.id}
                title={credential.name ?? credential.label}
                description={[
                  credential.name ? credential.label : undefined,
                  ownerLabel(credential.owner, spaces, me.user.id),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    ((id: string, label: string) =>
                      copy.mutate(
                        { id, owner: { kind: "space", spaceId: space.id } },
                        {
                          onSuccess: () => toast.success(`${label} copied`),
                          onError: (error) =>
                            toast.error("Could not copy the key", { description: errorMessage(error) }),
                        },
                      ))(credential.id, credential.label)
                  }
                >
                  Copy key
                </Button>
              </Row>
            ))}
          </Rows>
          <DialogFooter className="sm:justify-end">
            <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
