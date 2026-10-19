import { Dialog } from "./dialog.js"
import { Media } from "./media.js"

export type ImagePreviewProps = {
  source: string
  description: string
}

export function ImagePreview(props: ImagePreviewProps) {
  const name = props.description || "Image"
  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <button
          type="button"
          data-slot="image-preview"
          aria-label={`Open ${name}`}
          className="inline-flex max-w-full cursor-zoom-in rounded-container transition-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
        >
          <Media kind="image" frame="plain" fit="contain" source={props.source} description={props.description} />
        </button>
      </Dialog.Trigger>
      <Dialog.Content size="extra-wide" height="tall">
        <Dialog.Header>
          <Dialog.Title>{name}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Media kind="image" frame="viewer" loading="eager" source={props.source} description={props.description} />
          </div>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  )
}
