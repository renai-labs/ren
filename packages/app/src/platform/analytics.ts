export * as Analytics from "./analytics.js"

export interface Interface {
  readonly identify: (user: { readonly id: string; readonly email: string; readonly name: string }) => void
  readonly reset: () => void
  readonly capture: (event: string, properties: Readonly<Record<string, string>>) => void
  readonly captureException: (error: unknown) => void
}

export function make(options: {
  readonly key: string
  readonly apiHost: string
  readonly uiHost?: string
  readonly serverHost: string
  readonly autocaptureUrls: ReadonlyArray<RegExp>
}): Interface {
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
        autocapture: { url_allowlist: [...options.autocaptureUrls] },
        tracing_headers: [options.serverHost],
      })
      return loaded.default
    })
    .catch(() => undefined)
  const run = (call: (client: NonNullable<Awaited<typeof posthog>>) => void) =>
    void posthog.then((client) => client && call(client))
  return {
    identify: (user) => run((client) => client.identify(user.id, { email: user.email, name: user.name })),
    reset: () => run((client) => client.reset()),
    capture: (event, properties) => run((client) => void client.capture(event, properties)),
    captureException: (error) => run((client) => void client.captureException(error)),
  }
}
