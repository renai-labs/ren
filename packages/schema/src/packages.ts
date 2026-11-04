export * as Packages from "./packages.js"

import { Effect, Schema } from "effect"

const List = Schema.optionalKey(Schema.Array(Schema.NonEmptyString))

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  apt: List,
  npm: List,
  pip: List,
  go: List,
}).annotate({ identifier: "Packages.Info" })

export interface Setup extends Schema.Schema.Type<typeof Setup> {}
export const Setup = Schema.Struct({
  packages: Info.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  buildCommands: Schema.Array(Schema.NonEmptyString.check(Schema.isMaxLength(4096)))
    .check(Schema.isMaxLength(50))
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
}).annotate({
  identifier: "Packages.Setup",
  description: "What a machine installs, then the commands it runs, in order.",
})

export interface Step extends Schema.Schema.Type<typeof Step> {}
export const Step = Schema.Struct({
  command: Schema.NonEmptyString,
  arguments: Schema.Array(Schema.String),
  root: Schema.Boolean,
}).annotate({ identifier: "Packages.Step" })

export const steps = (setup: Setup): ReadonlyArray<Step> => {
  const packages = setup.packages
  return [
    ...(packages.apt?.length
      ? [
          { command: "apt-get", arguments: ["update"], root: true },
          {
            command: "env",
            arguments: [
              "DEBIAN_FRONTEND=noninteractive",
              "apt-get",
              "install",
              "--yes",
              "--no-install-recommends",
              ...packages.apt,
            ],
            root: true,
          },
        ]
      : []),
    ...(packages.npm?.length
      ? [{ command: "npm", arguments: ["install", "--global", ...packages.npm], root: true }]
      : []),
    ...(packages.pip?.length
      ? [
          {
            command: "python3",
            arguments: ["-m", "pip", "install", "--break-system-packages", ...packages.pip],
            root: true,
          },
        ]
      : []),
    ...(packages.go ?? []).map((name) => ({ command: "go", arguments: ["install", name], root: false })),
    ...setup.buildCommands.map((line) => ({ command: "sh", arguments: ["-c", line], root: false })),
  ]
}
