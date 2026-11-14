import type { FileSystem } from "@ren/schema/file-system"
import { SourceFiles } from "../../components/source-files.js"
import { useSpace } from "./use-space.js"

export function SpaceFiles(props: { source: FileSystem.Source }) {
  const space = useSpace()
  return (
    <SourceFiles
      scope={{ source: props.source, spaceId: space.id }}
      pins={props.source === "drive" ? ["artifacts"] : []}
      empty={`Open a file from ${space.name}’s ${props.source} to read it here.`}
    />
  )
}
