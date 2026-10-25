import { Toast } from "@ren/ui/toast"
import { useMutation } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { Channels } from "./channels.js"

export function useInstall(provider: Channels.Provider, title: string) {
  const context = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const start = useMutation(context.api["channel-connect"]["channel-install"].start.mutationOptions())
  return {
    isPending: start.isPending,
    install: () =>
      void start.mutateAsync({ provider }).then(
        (result) => platform.openExternal(result.redirectUrl),
        (cause: unknown) =>
          Toast.manager.add({
            type: "error",
            title: `Couldn’t install Ren on ${title}`,
            description: Channels.describe(cause),
          }),
      ),
  }
}
