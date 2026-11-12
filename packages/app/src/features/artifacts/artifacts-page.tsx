import { getRouteApi } from "@tanstack/react-router"
import { ArtifactGallery } from "../../components/artifact-gallery.js"
import { Page } from "../../components/page.js"

const route = getRouteApi("/_authed/_shell/artifacts")

export function ArtifactsPage() {
  const navigate = route.useNavigate()
  return (
    <ArtifactGallery.Root
      search={route.useSearch()}
      onSearch={(update, navigation) =>
        void navigate({ search: (previous) => ({ ...previous, ...update }), replace: navigation?.replace ?? false })
      }
    >
      <Page
        title="Artifacts"
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
