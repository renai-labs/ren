import { McpInspection } from "@ren/schema/mcp-inspection"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const McpInspectGroup = HttpApiGroup.make("mcp-inspect")
  .add(
    HttpApiEndpoint.post("mcp.inspect", "/mcp/inspect", {
      payload: McpInspection.Input,
      success: McpInspection.Result,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp.inspect",
        summary: "Inspect an MCP server",
        description:
          "Read a remote MCP server without signing in: the auth it asks for, what it says about itself, and its tools when it lists them without a sign-in or in its server card.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "mcp-inspect" }))
