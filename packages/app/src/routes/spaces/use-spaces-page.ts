import { useState } from "react"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { useMe } from "@/hooks/use-me"
import { api, errorMessage, pageSize, pickerPageSize } from "@/lib/api"
import { currentPage } from "@/lib/pagination"

const route = getRouteApi("/_authed/_shell/spaces")

export function useSpacesPage() {
  const search = route.useSearch()
  const navigate = useNavigate()
  const me = useMe()
  const page = currentPage(search)
  const spaces = useQuery({ ...api.space.list.queryOptions({ page, pageSize }), placeholderData: keepPreviousData })
  const [dialog, setDialog] = useState<"create" | "join" | null>(null)
  const joinable = useQuery({
    ...api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }),
    enabled: dialog === "join",
    select: (data) => data.items.filter((space) => space.membershipId === null),
  })
  const create = useMutation(api.space.create.mutationOptions())
  const join = useMutation(api["space-member"].create.mutationOptions())
  return {
    page,
    spaces: spaces.data?.items,
    total: spaces.data?.total ?? 0,
    stale: spaces.isPlaceholderData,
    loading: spaces.isPending,
    dialog,
    openDialog: setDialog,
    joinable: joinable.data ?? [],
    joinableLoading: joinable.isPending,
    creating: create.isPending,
    joining: join.isPending,
    createSpace: (input: { name: string; description: string }) =>
      create.mutate(
        { name: input.name, ...(input.description && { description: input.description }) },
        {
          onSuccess: (space) => {
            setDialog(null)
            toast.success(`Created ${space.name}`)
            void navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } })
          },
          onError: (error) => toast.error("Could not create the space", { description: errorMessage(error) }),
        },
      ),
    joinSpace: (spaceId: string, name: string) =>
      join.mutate(
        { payload: { spaceId, userId: me.user.id } },
        {
          onSuccess: () => {
            setDialog(null)
            toast.success(`Joined ${name}`)
            void navigate({ to: "/spaces/$spaceId", params: { spaceId } })
          },
          onError: (error) => toast.error("Could not join the space", { description: errorMessage(error) }),
        },
      ),
  }
}
