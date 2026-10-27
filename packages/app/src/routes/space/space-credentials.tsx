import { useState } from "react"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { IconChevronDown, IconCopy, IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CredentialSheet } from "@/components/ren/credential-sheet"
import { CredentialsTable } from "@/components/ren/credentials-table"
import { ListPagination } from "@/components/ren/list-pagination"
import { Row, Rows, SkeletonRows } from "@/components/ren/page"
import { ToolbarSearch } from "@/components/ren/toolbar-search"
import { useMe } from "@/hooks/use-me"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage, pageSize, pickerPageSize } from "@/lib/api"
import { canCopy, ownerLabel } from "@/lib/apps"
import { currentPage, lastPageAfterRemoval } from "@/lib/pagination"
import { useSpace } from "@/routes/space/use-space"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/credentials")

function useSpaceCredentials() {
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
      ...(needle && { search: needle }) }),
    placeholderData: keepPreviousData })
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
  return {
    space,
    me,
    spaces,
    page,
    total,
    loading: keys.isPending,
    stale: keys.isPlaceholderData,
    query,
    setQuery,
    visible: here,
    elsewhere,
    adding,
    setAdding,
    copying,
    setCopying,
    copy: (id: string, label: string) =>
      copy.mutate(
        { id, owner: { kind: "space", spaceId: space.id } },
        {
          onSuccess: () => toast.success(`${label} copied`),
          onError: (error) => toast.error("Could not copy the key", { description: errorMessage(error) }) },
      ),
    removed: () => {
      const next = lastPageAfterRemoval(page, total, pageSize)
      if (next !== page) void navigate({ search: (previous) => ({ ...previous, page: next }) })
    } }
}

export function SpaceCredentialsTab() {
  const page = useSpaceCredentials()
  const space = page.space
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-1">
        <ToolbarSearch label="Search keys" value={page.query} onChange={page.setQuery} />
        {page.elsewhere.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="xs" className="h-6.5" />}>
              <IconPlus />
              Add key
              <IconChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => page.setAdding(true)}>
                  <IconPlus />
                  Add key
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => page.setCopying(true)}>
                  <IconCopy />
                  Copy from a space
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="xs" className="h-6.5" onClick={() => page.setAdding(true)}>
            <IconPlus />
            Add key
          </Button>
        )}
      </div>
      {page.loading ? (
        <SkeletonRows count={3} />
      ) : (
        <CredentialsTable
          credentials={page.visible}
          stale={page.stale}
          onRemoved={page.removed}
          empty={page.query ? `Nothing matches “${page.query.trim()}”` : "No keys"}
        />
      )}
      <div className="flex items-center justify-between gap-4 empty:hidden">
        <ListPagination page={page.page} pageSize={pageSize} total={page.total} noun="key" />
      </div>
      <CredentialSheet
        open={page.adding}
        onOpenChange={page.setAdding}
        title="Add key to this space"
        description="Every chat in this space can use it."
        owners={[{ value: `space:${space.id}`, label: space.name }]}
        userId={page.me.user.id}
      />
      <Dialog open={page.copying} onOpenChange={page.setCopying}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy from a space</DialogTitle>
            <DialogDescription>
              A copy is a separate pasted key. Sign-ins cannot be copied; move them instead.
            </DialogDescription>
          </DialogHeader>
          <Rows>
            {page.elsewhere.map((credential) => (
              <Row
                key={credential.id}
                title={credential.name ?? credential.label}
                description={[
                  credential.name ? credential.label : undefined,
                  ownerLabel(credential.owner, page.spaces, page.me.user.id),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <Button
                  variant="outline"
                  size="xs"
                  className="h-6.5"
                  onClick={() => page.copy(credential.id, credential.label)}
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
