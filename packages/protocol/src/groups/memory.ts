import { Memory } from "@ren/schema/memory"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ForbiddenError, InvalidRequestError, NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

const scope = `Pass spaceId for a space’s memory; omit it for the organization’s memory. \`${Memory.root}\` is the root file that every chat in scope gets in its context.`

export const MemoryGroup = HttpApiGroup.make("memory")
  .add(
    HttpApiEndpoint.get("memory.list", "/memory", {
      query: Memory.ListInput,
      success: Schema.Array(Memory.Path),
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.list",
        summary: "List memory files",
        description: `List the file paths of a memory. ${scope}`,
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("memory.read", "/memory/file", {
      query: Memory.PathInput,
      success: Memory.File,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.read",
        summary: "Read a memory file",
        description: `Return the whole content of one memory file. ${scope}`,
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("memory.write", "/memory/file", {
      payload: Memory.WriteInput,
      success: HttpApiSchema.NoContent,
      error: [NotFoundError, ForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.write",
        summary: "Write a memory file",
        description: `Create a memory file or replace its whole content. Keep each fact to one short line and each file on one topic; prefer an edit for a small change. ${scope}`,
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("memory.edit", "/memory/file", {
      payload: Memory.EditInput,
      success: Memory.File,
      error: [NotFoundError, ForbiddenError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.edit",
        summary: "Edit a memory file",
        description: `Replace exact text in a memory file and return the new content. oldString must occur once unless replaceAll is set. ${scope}`,
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("memory.delete", "/memory/file", {
      query: Memory.PathInput,
      success: HttpApiSchema.NoContent,
      error: [NotFoundError, ForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.delete",
        summary: "Delete a memory file",
        description: `Delete one memory file. ${scope}`,
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "memory" }))
