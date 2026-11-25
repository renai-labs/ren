export * as Support from "./support.js"

export const opencode = ">=2.2.6 <2.4.0"

export const refusal = (app: { readonly version: string }) =>
  /^\d+\.\d+\.\d+$/.test(app.version) && !Bun.semver.satisfies(app.version, opencode)
    ? `The Ren plugin supports OpenCode ${opencode}, not ${app.version}, and registers nothing.`
    : undefined
