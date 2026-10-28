import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./dialog.js"
import { Media } from "./media.js"

export type ImagePreviewProps = {
  source: string
  description: string
}

export function ImagePreview(props: ImagePreviewProps) {
  const name = props.description || "Image"
  return (
    <Dialog>
      <DialogTrigger
        data-slot="image-preview"
        aria-label={`Open ${name}`}
        className="inline-flex max-w-full cursor-zoom-in rounded-container transition-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
      >
        <Media kind="image" frame="plain" fit="contain" source={props.source} description={props.description} />
      </DialogTrigger>
      <DialogContent className="flex h-[min(calc(var(--ren-container-content)-var(--ren-spacing-12)-var(--ren-spacing-12)),calc(100dvh-var(--ren-spacing-8)))] flex-col sm:max-w-256">
        <DialogHeader className="pr-8">
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Media kind="image" frame="viewer" loading="eager" source={props.source} description={props.description} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
