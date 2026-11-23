export * as RenPanels from "./panels.js"

import { Option, Schema } from "effect"
import type { RenCommands } from "./commands.js"
import { RenRpc } from "./rpc.js"

type Reader = Pick<RenCommands.Surface, "client" | "location">

export type Loaded<A> =
  | { readonly type: "ready"; readonly value: A }
  | { readonly type: "failed"; readonly message: string; readonly signedOut: boolean }

const Failure = Schema.Struct({ type: Schema.optionalKey(Schema.String), message: Schema.String })

const load = <A>(promise: Promise<A>): Promise<Loaded<A>> =>
  promise.then(
    (value) => ({ type: "ready", value }),
    (error: unknown) => {
      const failure = Schema.decodeUnknownOption(Failure)(error).pipe(
        Option.getOrElse(() => ({ type: undefined, message: "Ren did not answer." })),
      )
      return { type: "failed", message: failure.message, signedOut: failure.type === "signed_out" }
    },
  )

const rpc = (surface: Reader) => {
  const location = surface.location()
  return { client: surface.client.rpc(RenRpc.Definition), at: location && { location } }
}

export const changes = (
  surface: Reader,
  input: { readonly sessionID: string; readonly path?: string; readonly mode?: RenRpc.DiffMode },
) => {
  const ren = rpc(surface)
  return load(ren.client.changes(input, ren.at))
}

export const list = (surface: Reader, input: { readonly sessionID: string; readonly path?: string }) => {
  const ren = rpc(surface)
  return load(ren.client.listFiles(input, ren.at))
}

export const search = (surface: Reader, input: { readonly sessionID: string; readonly query: string }) => {
  const ren = rpc(surface)
  return load(ren.client.searchFiles(input, ren.at))
}

export const read = (surface: Reader, input: { readonly sessionID: string; readonly path: string }) => {
  const ren = rpc(surface)
  return load(ren.client.readFile(input, ren.at))
}

export const run = (surface: Reader, input: { readonly sessionID: string; readonly command: string }) => {
  const ren = rpc(surface)
  return load(ren.client.runShell(input, ren.at))
}

export const shells = (surface: Reader, input: { readonly sessionID: string }) => {
  const ren = rpc(surface)
  return load(ren.client.listShells(input, ren.at))
}

export const output = (
  surface: Reader,
  input: { readonly sessionID: string; readonly shellID: string; readonly cursor: number },
) => {
  const ren = rpc(surface)
  return load(ren.client.readShell(input, ren.at))
}

export const stop = (surface: Reader, input: { readonly sessionID: string; readonly shellID: string }) => {
  const ren = rpc(surface)
  return load(ren.client.stopShell(input, ren.at))
}

export const problem = <A>(loaded: Loaded<A> | undefined) => (loaded?.type === "failed" ? loaded.message : undefined)

export const ended = (read: RenRpc.ShellOutput) => read.shell.status !== "running" && read.cursor >= read.size

export const parent = (path: string) => {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path
  const slash = trimmed.lastIndexOf("/")
  return slash === -1 ? "" : trimmed.slice(0, slash + 1)
}

const filetypes: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascriptreact",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  py: "python",
  go: "go",
  rs: "rust",
  sh: "bash",
  yml: "yaml",
  yaml: "yaml",
  css: "css",
  html: "html",
  zig: "zig",
}

export const filetype = (path: string) => filetypes[path.slice(path.lastIndexOf(".") + 1).toLowerCase()]

export const status = (shell: RenRpc.ShellInfo) => {
  if (shell.status === "running") return "running"
  if (shell.status === "exited") return `exited ${shell.exit ?? "?"}`
  return shell.status === "timeout" ? "timed out" : "stopped"
}
