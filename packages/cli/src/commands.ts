export * as Commands from "./commands.js"

import { Argument, Command, Flag } from "effect/cli"

export const folder = {
  folder: Argument.String("folder").pipe(Argument.withDescription("Spec folder"), Argument.withDefault(".ren")),
}

export const applyOptions = {
  ...folder,
  plan: Flag.String("plan").pipe(Flag.withDescription("Plan digest (required noninteractively)"), Flag.optional),
  allowArchive: Flag.Boolean("allow-archive").pipe(
    Flag.withDescription("Allow archives noninteractively"),
    Flag.withDefault(false),
  ),
}

export const loginOptions = {
  noBrowser: Flag.Boolean("no-browser").pipe(
    Flag.withDescription("Print the sign-in URL only"),
    Flag.withDefault(false),
  ),
}

export const root = Command.make("ren2").pipe(Command.withDescription("Ren CLI"))
export const login = Command.make("login", loginOptions).pipe(Command.withDescription("Sign in"))
export const logout = Command.make("logout").pipe(Command.withDescription("Sign out"))
export const whoami = Command.make("whoami").pipe(Command.withDescription("Show the signed-in user"))
export const health = Command.make("health").pipe(Command.withDescription("Check server health"))
export const infra = Command.make("infra").pipe(Command.withDescription("Manage infrastructure"))
export const validate = Command.make("validate", folder).pipe(Command.withDescription("Validate a local spec"))
export const plan = Command.make("plan", folder).pipe(Command.withDescription("Preview changes"))
export const apply = Command.make("apply", applyOptions).pipe(Command.withDescription("Apply changes"))
export const pull = Command.make("pull", folder).pipe(Command.withDescription("Pull org settings, spaces and agents"))
