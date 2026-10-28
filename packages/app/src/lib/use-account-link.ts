import { Channel } from "@ren/schema/channel"
import { toast } from "@ren/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Platform } from "../platform/platform.js"
import { Auth } from "./auth.js"
import { RouterContext } from "./router-context.js"

export function useAccountLink(provider: "github" | "slack", returnTo: string) {
  const context = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const queryClient = useQueryClient()
  const title = Channel.titles[provider]
  const offered = useQuery({
    ...context.api["sign-in"]["sign-in-provider"].list.queryOptions(),
    select: (providers) => providers.items.includes(provider),
  })
  const accounts = useQuery(Auth.accountsOptions(context.auth))
  const linked = accounts.data?.find((account) => account.providerId === provider)
  const failed = (failure: string) => (error: Error) =>
    toast.add({ type: "error", title: failure, description: error.message })
  const link = useMutation({
    mutationFn: async () => {
      const result = await context.auth.linkSocial({ provider, callbackURL: `${platform.appUrl}${returnTo}` })
      if (result.error) throw new Error(result.error.message ?? "Try again.")
    },
    onError: failed(`Couldn’t connect ${title}`),
  })
  const unlink = useMutation({
    mutationFn: async () => {
      if (!linked) return
      const result = await context.auth.unlinkAccount({ accountId: linked.id })
      if (result.error) throw new Error(result.error.message ?? "Try again.")
      // ast-grep-ignore: no-manual-invalidation -- unlinking an account goes through Better Auth
      await queryClient.invalidateQueries({ queryKey: Auth.accountsOptions(context.auth).queryKey })
    },
    onError: failed(`Couldn’t disconnect ${title}`),
  })
  return {
    provider,
    title,
    offered: offered.data === true,
    linked: linked !== undefined,
    loading: offered.isLoading || accounts.isLoading,
    link,
    unlink,
  }
}
