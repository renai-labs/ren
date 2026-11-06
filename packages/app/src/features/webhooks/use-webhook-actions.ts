import type { WebhookInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"

export function useWebhookActions() {
  const { api } = RouterContext.useRouterContext()
  const update = useMutation(api.webhook.update.mutationOptions())
  const rotate = useMutation(api.webhook.rotateUrl.mutationOptions())
  const archive = useMutation(api.webhook.archive.mutationOptions())
  return {
    copyUrl: (webhook: WebhookInfo) =>
      navigator.clipboard.writeText(webhook.url).then(() => toast.success("URL copied")),
    setLive: (webhook: WebhookInfo, options: { readonly live: boolean }) =>
      update.mutateAsync(
        { id: webhook.id, mode: options.live ? "live" : "listening" },
        {
          onSuccess: () =>
            toast.success(options.live ? `${webhook.name} starts chats` : `${webhook.name} is listening`),
          onError: (error) => toast.error("Couldn’t switch the webhook", { description: errorMessage(error) }),
        },
      ),
    rotateUrl: (webhook: WebhookInfo) =>
      rotate.mutateAsync(
        { id: webhook.id },
        {
          onSuccess: () => toast.success("URL replaced. Paste the new one in the other app."),
          onError: (error) => toast.error("Couldn’t replace the URL", { description: errorMessage(error) }),
        },
      ),
    archive: (webhook: WebhookInfo) =>
      archive.mutateAsync(
        { id: webhook.id },
        {
          onSuccess: () => toast.success(`${webhook.name} archived`),
          onError: (error) => toast.error("Couldn’t archive the webhook", { description: errorMessage(error) }),
        },
      ),
  }
}
