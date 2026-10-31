import { lazy, Suspense } from "react"
import type { ComposerRepositories } from "../../../features/session/composer-repositories.js"

const AddRepositories = lazy(() =>
  import("../../../features/spaces/add-repositories-dialog.js").then((module) => ({
    default: module.SpaceAddRepositories,
  })),
)

export const addRepositories: ComposerRepositories.Dialog = (props) => (
  <Suspense fallback={null}>
    <AddRepositories spaceId={props.spaceId} onClose={props.onClose} />
  </Suspense>
)
