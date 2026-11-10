import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { ImageLightbox } from "../../components/image-lightbox.js"

export function WorkspaceImage(props: { root: Session.ID; path: string; alt: string; src?: string | undefined }) {
  if (props.src) return <ImagePreview src={props.src} alt={props.alt} />
  return <FileImage root={props.root} path={props.path} alt={props.alt} />
}

function FileImage(props: { root: Session.ID; path: string; alt: string }) {
  const read = ChatReact.useFile({ root: props.root, path: props.path })
  if (!AsyncResult.isSuccess(read.result))
    return (
      <output className="my-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
        {AsyncResult.isFailure(read.result) ? (
          <>
            Could not load {props.alt || "image"}.
            <Button variant="outline" size="sm" onClick={read.refresh}>
              Retry
            </Button>
          </>
        ) : (
          <>
            <Spinner />
            Loading {props.alt || "image"}…
          </>
        )}
      </output>
    )
  const file = read.result.value
  if (file.truncated || file.encoding !== "base64" || !/^image\/(?:png|jpeg|webp|gif|avif)$/u.test(file.mime))
    return <span className="text-sm text-muted-foreground">Could not preview {props.alt || "image"}.</span>
  return <ImagePreview src={`data:${file.mime};base64,${file.content}`} alt={props.alt} />
}

function ImagePreview(props: { src: string; alt: string }) {
  return (
    <ImageLightbox src={props.src} alt={props.alt} className="my-2 block w-fit max-w-full cursor-zoom-in rounded-md">
      <img src={props.src} alt={props.alt} className="max-h-96 max-w-full rounded-md border object-contain" />
    </ImageLightbox>
  )
}
