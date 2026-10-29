export * as Analytics from "./analytics.js"

export interface Interface {
  readonly identify: (
    user: { readonly id: string; readonly email: string; readonly name: string },
    organization: { readonly id: string; readonly name: string } | null,
  ) => void
  readonly reset: () => void
  readonly captureException: (error: unknown) => void
}

export function make(options: { readonly key: string; readonly apiHost: string; readonly uiHost?: string }): Interface {
  const posthog = new Promise((resolve) =>
    typeof requestIdleCallback === "function"
      ? requestIdleCallback(resolve, { timeout: 2000 })
      : setTimeout(resolve, 0),
  )
    .then(() => import("posthog-js"))
    .then((loaded) => {
      loaded.default.init(options.key, {
        api_host: options.apiHost,
        ...(options.uiHost && { ui_host: options.uiHost }),
        defaults: "2026-08-30",
        capture_exceptions: true,
      })
      return loaded.default
    })
    .catch(() => undefined)
  const run = (call: (client: NonNullable<Awaited<typeof posthog>>) => void) =>
    void posthog.then((client) => client && call(client))
  return {
    identify: (user, organization) =>
      run((client) => {
        client.identify(user.id, { email: user.email, name: user.name })
        if (organization === null) client.resetGroups()
        else if (client.getGroups()["organization"] !== organization.id)
          client.group("organization", organization.id, { name: organization.name })
      }),
    reset: () => run((client) => client.reset()),
    captureException: (error) => run((client) => void client.captureException(error)),
  }
}
