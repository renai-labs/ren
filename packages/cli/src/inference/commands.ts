export * as InferenceCommands from "./commands.js"

import { RenInference } from "@ren/schema/ren-inference"
import { Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"

const setupOptions = {
  harness: Argument.Literals("harness", RenInference.HarnessId.literals).pipe(
    Argument.withDescription("The harness to set up"),
    Argument.optional,
  ),
  keyEnv: Flag.String("key-env").pipe(
    Flag.withDescription("The variable that holds the key, for a harness that reads it from the environment"),
    Flag.optional,
  ),
  withOptional: Flag.Boolean("with-optional").pipe(
    Flag.withDescription("Also apply changes that replace a default, such as the default model"),
    Flag.withDefault(false),
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription("Show the changes and write nothing"),
    Flag.withDefault(false),
  ),
  yes: Flag.Boolean("yes").pipe(Flag.withDescription("Write without asking"), Flag.withDefault(false)),
  undo: Flag.Boolean("undo").pipe(
    Flag.withDescription("Restore the files of the newest backup; revokes no key"),
    Flag.withDefault(false),
  ),
}

const setup = () => import("./setup.js")

export const subcommands = [
  Command.make("setup", setupOptions).pipe(
    Command.withDescription("Point a harness at Ren’s models with a key of yours"),
    Command.withHandler((input) =>
      Effect.flatMap(Effect.promise(setup), (module) => module.InferenceSetup.setup(input)),
    ),
  ),
  Command.make("sync").pipe(
    Command.withDescription("Set up each harness that ren2 set up here again, with the live model list"),
    Command.withHandler(() => Effect.flatMap(Effect.promise(setup), (module) => module.InferenceSetup.sync())),
  ),
]
