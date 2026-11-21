import { Breadcrumb } from "../../components/breadcrumb.js"
import type { DriveSearch } from "../../lib/drive-search.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { DriveLink } from "./drive-link.js"

export function DriveCrumbs(props: {
  home: DriveSearch.Home
  space: string | undefined
  folder: string | undefined
  last?: string | undefined
}) {
  const spaces = useSpaces()
  const parts = (props.folder ?? "").split("/").filter(Boolean)
  const space = props.home.kind === "org" ? props.space : undefined
  const trail = [
    { key: "drive", label: "Drive", folder: undefined },
    ...(space ? [{ key: space, label: spaces.spaceName(space), folder: undefined }] : []),
    ...parts.map((part, index) => ({
      key: `${index}:${part}`,
      label: part,
      folder: `${parts.slice(0, index + 1).join("/")}/`,
    })),
  ]
  const ancestors = props.last ? trail : trail.slice(0, -1)
  if (ancestors.length === 0) return null
  return (
    <Breadcrumb.Root
      ancestors={ancestors.map((crumb) => ({
        key: crumb.key,
        content: (
          <DriveLink
            home={props.home}
            page="files"
            space={crumb.key === "drive" ? undefined : space}
            folder={crumb.folder}
            className="transition-colors hover:text-foreground"
          >
            {crumb.label}
          </DriveLink>
        ),
      }))}
    >
      <span className="font-medium">{props.last ?? trail.at(-1)?.label}</span>
    </Breadcrumb.Root>
  )
}
