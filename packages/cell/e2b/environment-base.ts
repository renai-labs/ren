export * as EnvironmentBase from "./environment-base.js"

import { Schema } from "effect"
import { Stage } from "./stage.js"

// oxlint-disable-next-line ren/no-comments -- The base image of every E2B environment template (specs/runtime/environments §3 Build rule 2). A deployment sets the printed tag as E2B_ENVIRONMENT_BASE; a new tag rebuilds every template. E2B fixes CPU and memory per template, so each template sets its own.
const Options = Schema.Struct({ E2B_ENVIRONMENT_BASE_NAME: Schema.optionalKey(Schema.String) })

if (import.meta.main) {
  const built = await Stage.build({
    name: Schema.decodeUnknownSync(Options)(Bun.env).E2B_ENVIRONMENT_BASE_NAME ?? "ren-environment-base",
    entrypoints: ["packages/executor/src/main.ts"],
    packages: ["@ren/executor"],
    dockerfiles: ["environment.Dockerfile"],
    startScript: "environment-start.sh",
    readyCommand: "pgrep -f /opt/ren/environment-start.sh",
    versionVariable: "REN_ENVIRONMENT_VERSION",
    size: { cpuCount: 2, memoryMB: 2048 },
  })
  process.stdout.write(`E2B_ENVIRONMENT_BASE=${built.tag}${built.isNew ? "" : " (exists; nothing to build)"}\n`)
}
