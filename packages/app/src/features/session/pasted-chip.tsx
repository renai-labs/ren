import { IconCopy, IconX } from "@tabler/icons-react"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@ren/ui/attachment"
import { Button } from "@ren/ui/button"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@ren/ui/dialog"
import { FileIcon } from "@ren/ui/file-icon"
import { useCopy } from "../../lib/use-copy.js"

export function PastedChip(props: {
  text: string
  disabled?: boolean | undefined
  onEdit?: (() => void) | undefined
  onRemove?: (() => void) | undefined
}) {
  const copy = useCopy()
  const count = props.text.split("\n").length
  return (
    <Dialog>
      <Attachment size="sm">
        <AttachmentMedia>
          <FileIcon name="pasted.txt" />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>Pasted text</AttachmentTitle>
          <AttachmentDescription className="tabular-nums">
            {count === 1 ? "1 line" : `${count} lines`}
          </AttachmentDescription>
        </AttachmentContent>
        {props.onEdit ? (
          <AttachmentTrigger
            aria-label="Show pasted text in the message"
            disabled={props.disabled}
            onClick={props.onEdit}
          />
        ) : (
          <DialogTrigger render={<AttachmentTrigger aria-label="Open pasted text" />} />
        )}
        {props.onRemove ? (
          <AttachmentActions>
            <AttachmentAction aria-label="Remove pasted text" disabled={props.disabled} onClick={props.onRemove}>
              <IconX />
            </AttachmentAction>
          </AttachmentActions>
        ) : null}
      </Attachment>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pasted text</DialogTitle>
        </DialogHeader>
        <CodeBlock className="min-w-0 rounded-none border-0 dark:bg-transparent">
          <CodeBlockContent wrap className="max-h-[60dvh] p-0">
            {props.text}
          </CodeBlockContent>
        </CodeBlock>
        {copy ? (
          <DialogFooter>
            <Button variant="ghost" className="text-muted-foreground" onClick={() => copy(props.text, "Text copied")}>
              <IconCopy data-icon="inline-start" />
              Copy
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
