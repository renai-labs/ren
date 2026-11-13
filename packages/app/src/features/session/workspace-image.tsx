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
import { ImageTrigger } from "../../components/image-set.js"
import { blockImage, inlineImage } from "../../components/markdown.js"
import { MediaLoading, MediaUnavailable } from "../../components/media-unavailable.js"
import { errorStatus } from "../../lib/errors.js"
import { formatBytes } from "../../lib/format.js"

const dataUrlBytes = (src: string) => {
  const match = /^data:[^,;]*;base64,(.*)$/su.exec(src)
  const base64 = match?.[1]
  return base64 === undefined ? undefined : Math.floor((base64.length * 3) / 4) - (/=*$/u.exec(base64)?.[0].length ?? 0)
}

export function WorkspaceImage(props: {
  root: Session.ID
  path: string
  alt: string
  src?: string | undefined
  inline: boolean
}) {
  if (props.src)
    return (
      <ImagePreview
        path={props.path}
        alt={props.alt}
        src={props.src}
        size={dataUrlBytes(props.src)}
        inline={props.inline}
      />
    )
  return <FileImage root={props.root} path={props.path} alt={props.alt} inline={props.inline} />
}

function FileImage(props: { root: Session.ID; path: string; alt: string; inline: boolean }) {
  const read = ChatReact.useFile({ root: props.root, path: props.path })
  if (AsyncResult.isFailure(read.result))
    return errorStatus(Cause.squash(read.result.cause)) === 404 ? (
      <MediaUnavailable reason="Not in the workspace" />
    ) : (
      <MediaUnavailable reason="Couldn't load" onRetry={read.refresh} />
    )
  if (!AsyncResult.isSuccess(read.result)) return <MediaLoading />
  const file = read.result.value
  if (file.truncated) return <MediaUnavailable reason="Too large to preview" />
  if (file.encoding !== "base64" || !/^image\/(?:png|jpeg|webp|gif|avif)$/u.test(file.mime))
    return <MediaUnavailable reason="Not an image" />
  return (
    <ImagePreview
      path={props.path}
      alt={props.alt}
      src={`data:${file.mime};base64,${file.content}`}
      size={file.size}
      inline={props.inline}
    />
  )
}

function ImagePreview(props: { path: string; alt: string; src: string; size: number | undefined; inline: boolean }) {
  const name = props.path.split("/").at(-1) ?? props.path
  const alt = props.alt || name
  if (props.inline) return <img src={props.src} alt={alt} className={inlineImage} />
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-1">
      <ImageTrigger src={props.src} name={alt}>
        <img src={props.src} alt={alt} className={blockImage} />
      </ImageTrigger>
      <Attachment size="sm" className="w-full max-w-64 min-w-0">
        <AttachmentMedia>
          <IconPhoto />
        </AttachmentMedia>
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
