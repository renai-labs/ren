import type { AppProfileItem } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { Platform } from "../platform/platform.js"
import { errorMessage } from "./errors.js"
import { RouterContext } from "./router-context.js"

const pollEvery = 2000

const fallbackWait = 10 * 60_000

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface Waiting {
  readonly profileId: string
  readonly label: string
  readonly before: string | null
  readonly tab: Window | null
  readonly until: number
}

export function useSignIn(onOpened?: (item: AppProfileItem) => void, onFailed?: () => void) {
  const platform = Platform.usePlatform()
  const { api, queryClient } = RouterContext.useRouterContext()
  const connect = useMutation(api["credential-connect"].credential.connect.mutationOptions())
  const connected = async (input: Waiting) => {
    const profile = await queryClient.fetchQuery({
      ...api["app-profile"].get.queryOptions({ idOrSlug: input.profileId }),
      staleTime: 0,
    })
    const item = profile.items.find((each) => each.label === input.label)
    return item?.status === "ok" && item.credentialId !== null && item.credentialId !== input.before
  }
  const poll = async (input: Waiting): Promise<void> => {
    await delay(pollEvery)
    if ((await connected(input)) || input.tab?.closed || Date.now() >= input.until) return
    return poll(input)
  }
  const wait = useMutation({ mutationKey: ["credential-connect", "wait"], mutationFn: poll })
  return {
    pending: connect.isPending,
    start: (
      profileId: string,
      item: AppProfileItem,
      tab: Window | null = platform.blankPopup?.() ?? platform.blankTab?.() ?? null,
    ) => {
      if (!("mcp" in item.item)) {
        tab?.close()
        onFailed?.()
        return
      }
      connect.mutate(
        { profileId, item: item.item, ...(item.status !== "missing" && { reconnect: true }) },
        {
          onSuccess: (result) => {
            if (!("redirectUrl" in result)) {
              tab?.close()
              return
            }
            if (tab) tab.location.href = result.redirectUrl
            else platform.openExternal(result.redirectUrl)
            wait.mutate({
              profileId,
              label: item.label,
              before: item.credentialId,
              tab,
              until: Date.parse(result.expiresAt) || Date.now() + fallbackWait,
            })
            if (onOpened) onOpened(item)
            else
              toast(`Sign in to ${item.name} in the window that opened`, {
                description: "It closes by itself when you’re done.",
              })
          },
          onError: (error) => {
            tab?.close()
            toast.error(`Could not sign in with ${item.name}`, { description: errorMessage(error) })
            onFailed?.()
          },
        },
      )
    },
  }
}
