import { Toast } from "@ren/ui/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Platform } from "../platform/platform.js"
import { Auth } from "./auth.js"
import { RouterContext } from "./router-context.js"

export function useGitHubLink(returnTo: string) {
  const context = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const queryClient = useQueryClient()
  const offered = useQuery({
    ...context.api["sign-in"]["sign-in-provider"].list.queryOptions(),
    select: (providers) => providers.items.includes("github"),
  })
  const accounts = useQuery(Auth.accountsOptions(context.auth))
  const linked = accounts.data?.find((account) => account.providerId === "github")
  const failed = (title: string) => (error: Error) =>
    Toast.manager.add({ type: "error", title, description: error.message })
  const link = useMutation({
    mutationFn: async () => {
      const result = await context.auth.linkSocial({ provider: "github", callbackURL: `${platform.appUrl}${returnTo}` })
      if (result.error) throw new Error(result.error.message ?? "Try again.")
    },
    onError: failed("Couldn’t connect GitHub"),
  })
  const unlink = useMutation({
    mutationFn: async () => {
      if (!linked) return
      const result = await context.auth.unlinkAccount({ accountId: linked.id })
      if (result.error) throw new Error(result.error.message ?? "Try again.")
      await queryClient.invalidateQueries({ queryKey: Auth.accountsOptions(context.auth).queryKey })
    },
    onError: failed("Couldn’t disconnect GitHub"),
  })
  return {
    offered: offered.data === true,
    linked: linked !== undefined,
    loading: offered.isLoading || accounts.isLoading,
    link,
    unlink,
  }
}
