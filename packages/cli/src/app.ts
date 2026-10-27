export * as App from "./app.js"

import { Effect } from "effect"
import { Command } from "effect/cli"
import { Commands } from "./commands.js"

export const command = Commands.root.pipe(
  Command.withSubcommands([
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
  ]),
)
