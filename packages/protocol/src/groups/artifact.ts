import { Artifact } from "@ren/schema/artifact"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

export const ArtifactGroup = Primitive.group(Artifact.definition, "sdk", [
  Primitive.list(Artifact.definition),
  Primitive.get(Artifact.definition).annotate(
    Mcp.Hidden,
    "An agent reads an artifact with the opencode artifact_read tool, which publishes it too.",
  ),
  Primitive.update(Artifact.definition).annotate(
    Mcp.Hidden,
    "A person renames an artifact in the app; an agent names one with the opencode artifact_create or artifact_update tool.",
  ),
  Primitive.archive(Artifact.definition).annotate(
    Mcp.Hidden,
    "A person archives an artifact in the app; an agent stops one with the opencode artifact_delete tool.",
  ),
])
