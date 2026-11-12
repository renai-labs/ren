import { useState } from "react"
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
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
import { LoadMore } from "../../components/load-more.js"
import { PageActions, Row, Rows, TableSample, useShapeId } from "../../components/page.js"
import { Loading } from "@ren/ui/loading"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { useMe } from "../../lib/use-me.js"
import { useDebouncedValue } from "../../lib/use-debounced-value.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { errorMessage } from "../../lib/errors.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { Pages } from "../../lib/pages.js"
import { canCopy, ownerLabel } from "../../lib/apps.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

export function SpaceCredentialsTab() {
  const { api, client } = RouterContext.useRouterContext()
  const space = useSpace()
  const me = useMe()
  const spaces = useSpaces().spaces
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const [adding, setAdding] = useState(false)
  const [copying, setCopying] = useState(false)
  const keys = useInfiniteQuery({
    ...Pages.credentials(client, { owner: "space", spaceId: space.id, ...(needle && { search: needle }) }),
    placeholderData: keepPreviousData,
    ...Loader.required,
  })
  const others = useQuery(api.credential.list.queryOptions({ owner: "space", page: 1, pageSize: pickerPageSize }))
  const copy = useMutation(api.credential.copy.mutationOptions())
  const here = keys.data?.pages.flatMap((page) => page.items) ?? []
  const elsewhere = (others.data?.items ?? []).filter(
    (credential) =>
      credential.owner.kind === "space" &&
      credential.owner.spaceId !== space.id &&
      canCopy(credential) &&
      !here.some((each) => each.label === credential.label),
  )
  const loading = keys.isPending
  const shapeId = useShapeId("keys")
  const stale = keys.isPlaceholderData
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageActions>
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
      </PageActions>
      <Loading id={shapeId} loading={loading} label="Loading keys">
        {loading ? (
          <TableSample columns={["Key", "Hosts", "Owner", ""]} count={3} />
        ) : (
          <CredentialsTable
            credentials={here}
            stale={stale}
            empty={query ? `Nothing matches “${query.trim()}”` : "No keys"}
          />
        )}
      </Loading>
      <LoadMore more={keys.hasNextPage} loading={keys.isFetchingNextPage} onMore={() => void keys.fetchNextPage()} />
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
