import { FileSystem } from "@ren/schema/file-system"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

const scope =
  "source picks the files: `drive` for a drive, `memory` for a memory. Pass spaceId for a space’s; omit it for the organization’s."

const errors = [NotFoundError, ForbiddenError, InvalidRequestError, UnavailableError]

export const FilesGroup = HttpApiGroup.make("files")
  .add(
    HttpApiEndpoint.get("files.list", "/files", {
      query: FileSystem.ListInput,
      success: FileSystem.Page,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "files.list",
        summary: "List a folder",
        description: `List the folders and files directly in one folder, folders first, one page at a time. A folder’s path ends with \`/\`; pass it as folder to list that folder. actions says what you may do in the folder. ${scope}`,
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("files.read", "/files/content", {
      query: FileSystem.PathInput,
      success: FileSystem.Content,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "files.read",
        summary: "Read a file",
        description: `Return a file: text as \`utf8\`, anything else as \`base64\`. A file over ${FileSystem.readLimit / 1024 / 1024} MiB returns its start, with truncated set; drive.download gives a link to a whole drive file. ${scope}`,
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("files.delete", "/files", {
      query: FileSystem.PathInput,
      success: HttpApiSchema.NoContent,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "files.delete",
        summary: "Delete a file",
        description: `Delete one file. There is no undo. ${scope}`,
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "files" }))
