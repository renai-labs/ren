import { getRouteApi } from "@tanstack/react-router"
import { ArtifactGallery } from "../../components/artifact-gallery.js"
import { Page } from "../../components/page.js"
import { spaceSections } from "../../components/route-skeleton.js"
import { useSpace } from "./use-space.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/artifacts")

export function SpaceArtifactsTab() {
  const navigate = route.useNavigate()
  const space = useSpace()
  return (
    <ArtifactGallery.Root
      spaceId={space.id}
      search={route.useSearch()}
      onSearch={(update, navigation) =>
        void navigate({ search: (previous) => ({ ...previous, ...update }), replace: navigation?.replace ?? false })
      }
    >
      <Page
        title={spaceSections.artifacts?.title ?? "Artifacts"}
        width="full"
        actions={
          <>
            <ArtifactGallery.Search />
            <ArtifactGallery.Filter />
            <ArtifactGallery.Display />
            <ArtifactGallery.Build />
          </>
        }
        leading={<ArtifactGallery.Controls />}
      >
        <ArtifactGallery.Body />
      </Page>
    </ArtifactGallery.Root>
  )
}
