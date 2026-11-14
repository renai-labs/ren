import type { ArtifactInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { IconArchive, IconExternalLink, IconLink, IconLinkOff, IconPencil } from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { errorMessage } from "../lib/errors.js"
import { RouterContext } from "../lib/router-context.js"
import { Platform } from "../platform/platform.js"
import { RowMenu } from "./row-menu.js"

export function useArtifactActions() {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const navigate = useNavigate()
  const archive = useMutation(api.artifact.archive.mutationOptions())
  const write = platform.writeClipboardText
  return {
    edit: (artifact: ArtifactInfo) =>
      void navigate({
        to: "/",
        search: {
          spaceId: artifact.spaceId,
          artifact: artifact.id,
          artifactName: artifact.title,
          prompt: `Edit @${artifact.title}`,
        },
      }),
    open: (url: string) => platform.openExternal(url),
    copy: write
      ? (url: string) =>
          void write(url).then(
            () => toast.success("Link copied", { description: url }),
            (error: unknown) => toast.error("Could not copy the link", { description: errorMessage(error) }),
          )
      : undefined,
    archive: (artifact: ArtifactInfo) =>
      archive.mutateAsync({ id: artifact.id }).then(
        () => toast.success(`“${artifact.title}” archived`),
        (error: unknown) => toast.error("Could not archive the artifact", { description: errorMessage(error) }),
      ),
  }
}

export function ArtifactMenu(props: {
  artifact: ArtifactInfo
  actions: ReturnType<typeof useArtifactActions>
  className?: string | undefined
}) {
  const artifact = props.artifact
  const url = artifact.url
  const actions = props.actions
  const copy = actions.copy
  return (
    <RowMenu
      label={`${artifact.title} actions`}
      className={props.className}
      items={[
        { label: "Edit", icon: IconPencil, onSelect: () => actions.edit(artifact) },
        ...(url === null
          ? []
          : [
              { label: "Open", icon: IconExternalLink, onSelect: () => actions.open(url) },
              ...(copy ? [{ label: "Copy link", icon: IconLink, onSelect: () => copy(url) }] : []),
            ]),
        {
          label: "Archive",
          icon: IconArchive,
          onSelect: () => actions.archive(artifact),
          confirm: {
            title: `Archive “${artifact.title}”?`,
            description:
              "Its link stops working for everyone who has it, and it leaves Artifacts. Ren keeps its source and data.",
            action: "Archive",
          },
        },
      ]}
    />
  )
}

export function ServingBadge(props: { artifact: ArtifactInfo }) {
  if (props.artifact.pendingDeploymentId !== null)
    return (
      <Badge variant="secondary" className="h-6">
        <Spinner data-icon="inline-start" />
        Updating
      </Badge>
    )
  if (props.artifact.url === null)
    return (
      <Badge variant="secondary" className="h-6">
        <IconLinkOff data-icon="inline-start" />
        Not served
      </Badge>
    )
  return null
}
