import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Field, FieldTitle } from "@ren/ui/field"
import { Icon } from "@ren/ui/icon"
import { InlineEdit } from "@ren/ui/inline-edit"
import { Page } from "@ren/ui/page"
import { toast } from "@ren/ui/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Auth } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"

export function GeneralSettings(props: { organizationId: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const options = Auth.organizationOptions(context.auth, props.organizationId)
  const organization = useQuery(options)
  return (
    <Page.Root title="General">
      {organization.isPending ? <Page.Skeletons body="settings" /> : null}
      {organization.isError ? (
        <Page.Section frame="divided">
          <Empty role="alert">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon glyph="AlertCircle" />
              </EmptyMedia>
              <EmptyTitle>Couldn’t load the organization.</EmptyTitle>
              <EmptyDescription>{organization.error.message}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Page.Section>
      ) : null}
      {organization.isSuccess ? (
        <Page.Section frame="divided" key={organization.data.id}>
          <Field orientation="horizontal">
            <FieldTitle>Name</FieldTitle>
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
                  toast.add({ type: "error", title: message })
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
          </Field>
        </Page.Section>
      ) : null}
    </Page.Root>
  )
}
