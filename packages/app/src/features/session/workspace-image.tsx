import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { IconDownload, IconPhoto } from "@tabler/icons-react"
import { Cause } from "effect"
import { AsyncResult } from "effect/reactivity"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@ren/ui/attachment"
import { Link } from "@ren/ui/link"
import { ImageLightbox } from "../../components/image-lightbox.js"
import { useMediaLayout } from "../../components/media-gallery.js"
import { MediaLoading, MediaUnavailable } from "../../components/media-unavailable.js"
import { errorStatus } from "../../lib/errors.js"
import { formatBytes } from "../../lib/format.js"

const dataUrlBytes = (src: string) => {
  const match = /^data:[^,;]*;base64,(.*)$/su.exec(src)
  const base64 = match?.[1]
  return base64 === undefined ? undefined : Math.floor((base64.length * 3) / 4) - (/=*$/u.exec(base64)?.[0].length ?? 0)
}

export function WorkspaceImage(props: { root: Session.ID; path: string; alt: string; src?: string | undefined }) {
  if (props.src)
    return <ImagePreview path={props.path} alt={props.alt} src={props.src} size={dataUrlBytes(props.src)} />
  return <FileImage root={props.root} path={props.path} alt={props.alt} />
}

function FileImage(props: { root: Session.ID; path: string; alt: string }) {
  const layout = useMediaLayout()
  const read = ChatReact.useFile({ root: props.root, path: props.path })
  if (AsyncResult.isFailure(read.result))
    return errorStatus(Cause.squash(read.result.cause)) === 404 ? (
      <MediaUnavailable reason="Not in the workspace" className={layout.box} />
    ) : (
      <MediaUnavailable reason="Couldn't load" onRetry={read.refresh} className={layout.box} />
    )
  if (!AsyncResult.isSuccess(read.result)) return <MediaLoading className={layout.box} />
  const file = read.result.value
  if (file.truncated) return <MediaUnavailable reason="Too large to preview" className={layout.box} />
  if (file.encoding !== "base64" || !/^image\/(?:png|jpeg|webp|gif|avif)$/u.test(file.mime))
    return <MediaUnavailable reason="Not an image" className={layout.box} />
  return (
    <ImagePreview path={props.path} alt={props.alt} src={`data:${file.mime};base64,${file.content}`} size={file.size} />
  )
}

function ImagePreview(props: { path: string; alt: string; src: string; size: number | undefined }) {
  const layout = useMediaLayout()
  const name = props.path.split("/").at(-1) ?? props.path
  const alt = props.alt || name
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-1">
      <ImageLightbox src={props.src} alt={alt} className={layout.trigger}>
        <img src={props.src} alt={alt} className={layout.image} />
      </ImageLightbox>
      <Attachment size="sm" className="w-full max-w-64 min-w-0">
        {layout.compact ? null : (
          <AttachmentMedia>
            <IconPhoto />
          </AttachmentMedia>
        )}
        <AttachmentContent>
          <AttachmentTitle title={name} className="line-clamp-2 break-all whitespace-normal">
            {name}
          </AttachmentTitle>
          {props.size === undefined ? null : (
            <AttachmentDescription className="tabular-nums">{formatBytes(props.size)}</AttachmentDescription>
          )}
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction
            aria-label={`Save ${name}`}
            nativeButton={false}
            render={<Link appearance="plain" href={props.src} download={name} />}
          >
            <IconDownload />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
    </div>
  )
}
