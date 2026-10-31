import type { SessionMessage } from "@ren/schema/session/message"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@ren/ui/attachment"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import { ImageLightbox } from "@ren/ui/image-lightbox"
import { IconClipboardText, IconFile } from "@tabler/icons-react"
import { useState } from "react"
import type { ReactNode } from "react"

const isPasteBlock = (text: string) => text.length >= 2000 || text.split("\n").length >= 20

function splitPasted(text: string) {
  const separator = text.indexOf("\n\n")
  const head = separator === -1 ? text : text.slice(0, separator)
  const tail = separator === -1 ? "" : text.slice(separator + 2)
  if (tail && isPasteBlock(tail) && !isPasteBlock(head)) return { typed: head, pasted: tail }
  if (isPasteBlock(text)) return { typed: "", pasted: text }
  return { typed: text, pasted: undefined }
}

function PastedChip(props: { text: string }) {
  const [open, setOpen] = useState(false)
  const lines = props.text.split("\n").length
  return (
    <div className="flex flex-col items-end gap-2">
      <Attachment size="sm">
        <AttachmentMedia>
          <IconClipboardText />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>Pasted text</AttachmentTitle>
          <AttachmentDescription className="tabular-nums">
            {lines === 1 ? "1 line" : `${lines} lines`}
          </AttachmentDescription>
        </AttachmentContent>
        <AttachmentTrigger aria-label={open ? "Hide pasted text" : "Show pasted text"} onClick={() => setOpen(!open)} />
      </Attachment>
      {open ? (
        <CodeBlock size="sm" className="w-full">
          <CodeBlockContent wrap className="max-h-64">
            {props.text}
          </CodeBlockContent>
        </CodeBlock>
      ) : null}
    </div>
  )
}

function FileChips(props: { files: ReadonlyArray<SessionMessage.FileAttachment> }) {
  return (
    <AttachmentGroup className="justify-end">
      {props.files.map((file, index) => {
        const image = file.mime.startsWith("image/") && file.source.type === "inline" && file.data
        const name = file.name ?? "Attachment"
        return (
          // oxlint-disable-next-line react/no-array-index-key -- two attachments can share a name and type
          <Attachment key={`${name}-${index}`} size="sm">
            {image ? (
              <AttachmentMedia variant="image">
                <ImageLightbox
                  src={`data:${file.mime};base64,${file.data}`}
                  alt={file.name ?? "Image"}
                  className="size-full cursor-zoom-in"
                >
                  <img src={`data:${file.mime};base64,${file.data}`} alt={file.name ?? "Image"} />
                </ImageLightbox>
              </AttachmentMedia>
            ) : (
              <AttachmentMedia>
                <IconFile />
              </AttachmentMedia>
            )}
            <AttachmentContent>
              <AttachmentTitle>{name}</AttachmentTitle>
              <AttachmentDescription>{file.mime}</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        )
      })}
    </AttachmentGroup>
  )
}

export function UserBody(props: { message: SessionMessage.User; children: (typed: string) => ReactNode }) {
  const parts = splitPasted(props.message.text)
  return (
    <>
      {props.message.files?.length ? <FileChips files={props.message.files} /> : null}
      {parts.pasted ? <PastedChip text={parts.pasted} /> : null}
      {parts.typed ? props.children(parts.typed) : null}
    </>
  )
}
