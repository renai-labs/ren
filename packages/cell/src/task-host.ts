export * as TaskHost from "./task-host.js"

import type { Plugin } from "@opencode/plugin/effect"
import { Tool } from "@opencode/schema/tool"
import { HostTasks } from "@ren/host-api/tasks"
import { Task } from "@ren/schema/task"
import { TaskComment } from "@ren/schema/task-comment"
import { Label } from "@ren/schema/label"
import { Context, Effect, Layer, Option, Schema, type Scope } from "effect"
import { Cell } from "./cell.js"
import { HostToken } from "./host-token.js"

export class Service extends Context.Service<
  Service,
  { readonly register: (tool: Plugin.Context["tool"]) => Effect.Effect<void, never, Scope.Scope> }
>()("@ren/cell/TaskHost") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cell = yield* Cell.Info
    const tokens = yield* HostToken.Service
    if (!cell.vars.REN_URL) return yield* Effect.die(new Error("TaskHost needs REN_URL"))
    const host = yield* HostToken.client(cell.vars.REN_URL)
    const define = <
      Input extends Schema.Top & { readonly DecodingServices: never },
      Output extends Schema.Top & { readonly EncodingServices: never },
      E,
      R,
    >(
      name: keyof typeof HostTasks.descriptions,
      input: Input,
      output: Output,
      call: (payload: Input["Type"]) => Effect.Effect<Output["Type"], E, R>,
    ) => ({
      name,
      options: { codemode: false },
      description: HostTasks.descriptions[name],
      input: Schema.toEncoded(Schema.toCodecJson(input)),
      execute: (value: unknown) =>
        Effect.gen(function* () {
          const token = yield* tokens.current
          if (Option.isNone(token)) return yield* new Tool.Error({ message: "The cell has no valid host token." })
          const payload = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(input))(value)
          const result = yield* call(payload).pipe(HostToken.withToken(token.value))
          return { content: JSON.stringify(yield* Schema.encodeEffect(Schema.toCodecJson(output))(result)) }
        }).pipe(
          Effect.mapError(
            (error) => new Tool.Error({ message: error instanceof Error ? error.message : String(error) }),
          ),
        ),
    })
    const tools: ReadonlyArray<Tool.Info<Schema.Codec<unknown, unknown>>> = [
      define("task_list", HostTasks.ListInput, Task.definition.list.page, (payload) =>
        host.tasks.task_list({ payload }),
      ),
      define("task_get", HostTasks.GetInput, HostTasks.GetResult, (payload) => host.tasks.task_get({ payload })),
      define("task_create", HostTasks.CreateInput, Task.Info, (payload) => host.tasks.task_create({ payload })),
      define("task_update", HostTasks.UpdateInput, Task.Info, (payload) => host.tasks.task_update({ payload })),
      define("task_assign", HostTasks.AssignInput, HostTasks.AssignResult, (payload) =>
        host.tasks.task_assign({ payload }),
      ),
      define("task_review", HostTasks.ReviewInput, Task.Info, (payload) => host.tasks.task_review({ payload })),
      define("task_comment", TaskComment.CreateInput, TaskComment.Info, (payload) =>
        host.tasks.task_comment({ payload }),
      ),
      define("label_list", Label.ListInput, Label.definition.list.page, (payload) =>
        host.tasks.label_list({ payload }),
      ),
    ]
    return Service.of({
      register: (tool) =>
        tool
          .transform((editor) => {
            for (const definition of tools) editor.add(definition)
          })
          .pipe(Effect.asVoid),
    })
  }),
)
