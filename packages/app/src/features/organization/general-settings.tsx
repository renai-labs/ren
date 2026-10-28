import { Field } from "@ren/ui/field"
import { InlineEdit } from "@ren/ui/inline-edit"
import { LoadingMessage } from "@ren/ui/loading-message"
import { PageShell } from "@ren/ui/page-shell"
import { StateMessage } from "@ren/ui/state-message"
import { Toast } from "@ren/ui/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Auth } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"

export function GeneralSettings(props: { organizationId: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const options = Auth.organizationOptions(context.auth, props.organizationId)
  const organization = useQuery(options)
  return (
    <PageShell.Root layout="settings" title="General">
      {organization.isPending ? <LoadingMessage placement="section" /> : null}
      {organization.isError ? (
        <PageShell.Section frame="divided">
          <StateMessage
            state="failed"
            placement="inline"
            title="Couldn’t load the organization."
            description={organization.error.message}
          />
        </PageShell.Section>
      ) : null}
      {organization.isSuccess ? (
        <PageShell.Section frame="divided" key={organization.data.id}>
          <Field.Root label="Name" orientation="row">
            <InlineEdit
              label="Organization name"
              alignment="end"
              placeholder="Enter organization name"
              required
              value={organization.data.name}
              onCommit={async (name) => {
                const result = await context.auth.organization.update({
                  organizationId: props.organizationId,
                  data: { name },
                })
                if (result.error !== null) {
                  const message = result.error.message ?? "Failed to update organization"
                  Toast.manager.add({ type: "error", title: message })
                  throw new Error(message)
                }
                await Promise.all(
                  [options.queryKey, context.api.me.get.queryKey()].map((queryKey) =>
                    // ast-grep-ignore: no-manual-invalidation -- the organization name changes through Better Auth
                    queryClient.invalidateQueries({ queryKey }),
                  ),
                )
              }}
            />
          </Field.Root>
        </PageShell.Section>
      ) : null}
    </PageShell.Root>
  )
}
