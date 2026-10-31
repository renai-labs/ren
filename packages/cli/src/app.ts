export * as App from "./app.js"

import { Effect } from "effect"
import { Command } from "effect/cli"
import { Commands } from "./commands.js"
import { commands } from "./generated/commands.js"

export const command = Commands.root.pipe(
  Command.withSubcommands([
    Commands.login.pipe(
      Command.withHandler((input) =>
        Effect.promise(() => import("./commands/auth.js")).pipe(
          Effect.flatMap((module) => module.AuthCommand.login(input)),
        ),
      ),
    ),
    Commands.logout.pipe(
      Command.withHandler(() =>
        Effect.promise(() => import("./commands/auth.js")).pipe(Effect.flatMap((module) => module.AuthCommand.logout)),
      ),
    ),
    Commands.whoami.pipe(
      Command.withHandler(() =>
        Effect.promise(() => import("./commands/auth.js")).pipe(Effect.flatMap((module) => module.AuthCommand.whoami)),
      ),
    ),
    Commands.upgrade.pipe(
      Command.withHandler((input) =>
        Effect.promise(() => import("./upgrade.js")).pipe(Effect.flatMap((module) => module.Upgrade.run(input))),
      ),
    ),
    Commands.health.pipe(
      Command.withHandler(() =>
        Effect.promise(() => import("./commands/health.js")).pipe(Effect.flatMap((module) => module.Health.run)),
      ),
    ),
    Commands.infra.pipe(
      Command.withSubcommands([
        Commands.validate.pipe(
          Command.withHandler((input) =>
            Effect.promise(() => import("./infra/command.js")).pipe(
              Effect.flatMap((module) => module.InfraCommand.validate(input)),
            ),
          ),
        ),
        Commands.plan.pipe(
          Command.withHandler((input) =>
            Effect.promise(() => import("./infra/command.js")).pipe(
              Effect.flatMap((module) => module.InfraCommand.plan(input)),
            ),
          ),
        ),
        Commands.apply.pipe(
          Command.withHandler((input) =>
            Effect.promise(() => import("./infra/command.js")).pipe(
              Effect.flatMap((module) => module.InfraCommand.apply(input)),
            ),
          ),
        ),
        Commands.pull.pipe(
          Command.withHandler((input) =>
            Effect.promise(() => import("./infra/command.js")).pipe(
              Effect.flatMap((module) => module.InfraCommand.pull(input)),
            ),
          ),
        ),
      ]),
    ),
    { group: "Resources", commands },
  ]),
)
