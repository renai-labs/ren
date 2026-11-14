import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import type { DriveSearch } from "../../lib/drive-search.js"

export function DriveLink(props: {
  home: DriveSearch.Home
  page: "files" | "artifacts"
  space?: string | undefined
  folder?: string | undefined
  file?: string | undefined
  className?: string | undefined
  children: ReactNode
}) {
  const home = props.home
  if (home.kind === "space")
    return props.page === "artifacts" ? (
      <Link to="/spaces/$spaceId/drive/artifacts" params={{ spaceId: home.spaceId }} className={props.className}>
        {props.children}
      </Link>
    ) : (
      <Link
        to="/spaces/$spaceId/drive"
        params={{ spaceId: home.spaceId }}
        search={{ folder: props.folder, file: props.file }}
        className={props.className}
      >
        {props.children}
      </Link>
    )
  return props.page === "artifacts" ? (
    <Link to="/drive/artifacts" search={{ space: props.space }} className={props.className}>
      {props.children}
    </Link>
  ) : (
    <Link
      to="/drive"
      search={{ space: props.space, folder: props.folder, file: props.file }}
      className={props.className}
    >
      {props.children}
    </Link>
  )
}
