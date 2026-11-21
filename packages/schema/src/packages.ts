export * as Packages from "./packages.js"

import { Effect, Schema } from "effect"

const list = (title: string, example: string) =>
  Schema.optionalKey(Schema.Array(Schema.NonEmptyString).annotate({ title, examples: [[example]] }))

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  apt: list("APT packages", "ffmpeg"),
  npm: list("npm packages", "typescript"),
  pip: list("pip packages", "requests"),
  go: list("Go modules", "golang.org/x/tools/gopls@latest"),
}).annotate({ identifier: "Packages.Info", title: "Packages", description: "One per line." })

export interface Setup extends Schema.Schema.Type<typeof Setup> {}
export const Setup = Schema.Struct({
  packages: Info.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  buildCommands: Schema.Array(Schema.NonEmptyString.check(Schema.isMaxLength(4096)))
    .check(Schema.isMaxLength(50))
    .annotate({
      title: "Build commands",
      description: "Run in order after the packages. One per line.",
      examples: [["corepack enable"]],
    })
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
}).annotate({
  identifier: "Packages.Setup",
  description: "What a machine installs, then the commands it runs, in order.",
})

// oxlint-disable-next-line ren/no-comments -- A shell command that changes a machine, as root or as the machine's user.
export interface Step extends Schema.Schema.Type<typeof Step> {}
export const Step = Schema.Struct({ command: Schema.String, user: Schema.Literals(["root", "user"]) }).annotate({
  identifier: "Packages.Step",
})

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`

const quoteAll = (names: ReadonlyArray<string> | undefined) => (names ?? []).map(quote).join(" ")

// oxlint-disable-next-line ren/no-comments -- One step per package manager, as root, which installs the manager when the system lacks it; then one step per build command, as the machine's user.
export const steps = (setup: Setup): ReadonlyArray<Step> => {
  const root = (command: string): Step => ({ command, user: "root" })
  const apt = "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y"
  const packages = setup.packages
  return [
    ...(packages.apt?.length ? [root(`${apt} ${quoteAll(packages.apt)}`)] : []),
    ...(packages.npm?.length
      ? [root(`(command -v npm || (${apt} nodejs npm)) && npm install -g ${quoteAll(packages.npm)}`)]
      : []),
    ...(packages.pip?.length
      ? [
          root(
            `(command -v pip3 || (${apt} python3-pip)) && pip3 install --break-system-packages ${quoteAll(packages.pip)}`,
          ),
        ]
      : []),
    ...(packages.go?.length
      ? [root(`(command -v go || (${apt} golang-go)) && GOBIN=/usr/local/bin go install ${quoteAll(packages.go)}`)]
      : []),
    ...setup.buildCommands.map((command): Step => ({ command, user: "user" })),
  ]
}
