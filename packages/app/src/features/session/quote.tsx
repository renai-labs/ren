import { useState, type RefObject } from "react"
import { IconQuote } from "@tabler/icons-react"
import { Composer } from "@ren/chat"
import type { SessionInbox } from "@ren/schema/session/inbox"
import type { SessionMessage } from "@ren/schema/session/message"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Popover, PopoverContent } from "@ren/ui/popover"
import { Textarea } from "@ren/ui/textarea"
import { cn } from "cn"
import { useTextSelection, type TextSelection } from "../../lib/use-text-selection.js"

export interface QuoteDraft {
  readonly text: string
  readonly source?: string
  readonly comment?: string
}

export interface QuoteProps {
  readonly working: boolean
  readonly followUp: SessionInbox.Delivery
  readonly onQuote: (quote: QuoteDraft) => void
  readonly onSend: (quote: QuoteDraft, delivery: SessionInbox.Delivery) => Promise<unknown>
}

const draftOf = (selection: TextSelection): QuoteDraft => ({
  text: selection.text,
  ...(selection.source && { source: selection.source }),
})

const anchorOf = (selection: TextSelection) => {
  const container = selection.range.commonAncestorContainer
  return {
    getBoundingClientRect: () => selection.range.getBoundingClientRect(),
    contextElement: container instanceof Element ? container : (container.parentElement ?? undefined),
  }
}

function Toolbar(props: { selection: TextSelection; onQuote: () => void; onComment: () => void }) {
  return (
    <Popover open>
      <PopoverContent
        anchor={anchorOf(props.selection)}
        side="top"
        sideOffset={8}
        initialFocus={false}
        aria-label="Quote selection"
        className="w-auto flex-row items-center gap-0.5 p-1"
        onPointerDown={(event) => event.preventDefault()}
      >
        {props.selection.text.length > Composer.quoteLimit ? (
          <span className="px-2 py-1 text-sm text-muted-foreground">Selection too long</span>
        ) : (
          <>
            <Button variant="ghost" size="sm" title="Alt + select quotes at once" onClick={props.onQuote}>
              <IconQuote />
              Quote
            </Button>
            <Button variant="ghost" size="sm" onClick={props.onComment}>
              <IconQuote />
              Quote and comment
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function CommentBox(props: { selection: TextSelection; quote: QuoteProps; onClose: () => void }) {
  const [comment, setComment] = useState("")
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const working = props.quote.working
  const primary = working ? props.quote.followUp : "steer"
  const send = (delivery: SessionInbox.Delivery) => {
    if (sending) return
    setSending(true)
    setFailed(false)
    props.quote.onSend({ ...draftOf(props.selection), comment }, delivery).then(props.onClose, () => {
      setFailed(true)
      setSending(false)
    })
  }
  const action = (delivery: SessionInbox.Delivery, label: string) => (
    <Button
      key={delivery}
      variant={primary === delivery ? "default" : "secondary"}
      size="sm"
      disabled={sending}
      onClick={() => send(delivery)}
    >
      {label}
    </Button>
  )
  const queue = action("queue", "Queue quote")
  const steer = action("steer", working ? "Steer with quote" : "Send quote")
  const actions = primary === "queue" ? [steer, queue] : [queue, steer]
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open && !sending) props.onClose()
      }}
    >
      <PopoverContent
        anchor={anchorOf(props.selection)}
        side="bottom"
        align="start"
        aria-label="Quote and comment"
        className="w-80"
      >
        <div className="border-l-2 border-primary/60 pl-2 text-sm text-muted-foreground">
          <p className="line-clamp-2 whitespace-pre-wrap">{props.selection.text}</p>
          {props.selection.source ? <p className="text-xs">{props.selection.source}</p> : null}
        </div>
        <Textarea
          value={comment}
          disabled={sending}
          aria-label="Comment on the quote"
          placeholder="Add a comment about this quote"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the box opens because the person asked to comment
          autoFocus
          className="max-h-40 min-h-16 text-sm"
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onClose()
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send(primary)
            }
          }}
        />
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn’t send. Your comment is still here. Try again.</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2">{working ? actions : steer}</div>
      </PopoverContent>
    </Popover>
  )
}

export function QuoteSelection(props: { quote: QuoteProps | undefined; root: RefObject<HTMLElement | null> }) {
  return props.quote ? <SelectedQuote {...props.quote} root={props.root} /> : null
}

function SelectedQuote(props: QuoteProps & { root: RefObject<HTMLElement | null> }) {
  const [commenting, setCommenting] = useState<TextSelection | undefined>()
  const onQuote = props.onQuote
  const watched = useTextSelection({
    root: props.root,
    paused: commenting !== undefined,
    onAlt: (selection) => onQuote(draftOf(selection)),
  })
  const selected = watched.selected
  if (commenting) return <CommentBox selection={commenting} quote={props} onClose={() => setCommenting(undefined)} />
  if (!selected) return null
  return (
    <Toolbar
      selection={selected}
      onQuote={() => {
        onQuote(draftOf(selected))
        window.getSelection()?.removeAllRanges()
        watched.clear()
      }}
      onComment={() => {
        setCommenting(selected)
        watched.clear()
      }}
    />
  )
}

function QuoteCard(props: { quote: SessionMessage.Quote }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex max-w-full flex-col gap-1 self-end rounded-lg border-l-2 border-primary/60 bg-muted/50 px-3 py-2 text-sm">
      <Button
        variant="ghost"
        aria-expanded={open}
        className={cn(
          "h-auto justify-start p-0 text-left font-normal whitespace-pre-wrap text-muted-foreground hover:bg-transparent",
          !open && "line-clamp-3 block overflow-hidden",
        )}
        onClick={() => setOpen((current) => !current)}
      >
        {props.quote.text}
      </Button>
      {props.quote.source ? <span className="text-xs text-muted-foreground">{props.quote.source}</span> : null}
      {props.quote.comment ? <p className="whitespace-pre-wrap">{props.quote.comment}</p> : null}
    </div>
  )
}

export function QuoteCards(props: { comments: ReadonlyArray<SessionMessage.Quote> }) {
  return props.comments.map((quote) => (
    <QuoteCard key={`${quote.source}:${quote.text}:${quote.comment}`} quote={quote} />
  ))
}
