import { useState, type RefObject } from "react"
import { IconMessage, IconQuote } from "@tabler/icons-react"
import { Composer } from "@ren/chat"
import type { SessionInbox } from "@ren/schema/session/inbox"
import type { SessionMessage } from "@ren/schema/session/message"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
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

const lastLine = (range: Range) =>
  [...range.getClientRects()].findLast((rect) => rect.width > 0) ?? range.getBoundingClientRect()

const anchorOf = (selection: TextSelection) => {
  const container = selection.range.commonAncestorContainer
  return {
    getBoundingClientRect: () => lastLine(selection.range),
    contextElement: container instanceof Element ? container : (container.parentElement ?? undefined),
  }
}

function Toolbar(props: { selection: TextSelection; onQuote: () => void; onComment: () => void }) {
  return (
    <Popover open>
      <PopoverContent
        anchor={anchorOf(props.selection)}
        side="bottom"
        sideOffset={6}
        initialFocus={false}
        aria-label="Quote selection"
        className="w-auto flex-row items-center gap-0.5 rounded-xl p-1"
        onPointerDown={(event) => event.preventDefault()}
      >
        {props.selection.text.length > Composer.quoteLimit ? (
          <span className="px-2 py-1 text-sm text-muted-foreground">Selection too long</span>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-lg active:scale-[0.97]"
              title="Alt + select quotes at once"
              onClick={props.onQuote}
            >
              <IconQuote />
              Quote
            </Button>
            <Button variant="ghost" size="sm" className="rounded-lg active:scale-[0.97]" onClick={props.onComment}>
              <IconMessage />
              Comment
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
        sideOffset={6}
        aria-label="Quote and comment"
        className="w-80 rounded-xl"
      >
        <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-2.5 py-2 text-sm text-muted-foreground">
          <IconQuote className="mt-0.75 size-3.5 shrink-0" />
          <p className="line-clamp-2 min-w-0 whitespace-pre-wrap">{props.selection.text}</p>
        </div>
        <Textarea
          value={comment}
          disabled={sending}
          aria-label="Comment on the quote"
          placeholder="e.g. Is this still true?"
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
  const quote = props.quote
  return (
    <div className="flex max-w-[80%] min-w-0 flex-col items-end gap-1 self-end">
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-label={open ? "Show less of the quote" : "Show all of the quote"}
        className="h-auto max-w-full items-start justify-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-left text-sm font-normal whitespace-normal text-muted-foreground hover:bg-muted aria-expanded:bg-muted/50 aria-expanded:text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
        onClick={() => setOpen((current) => !current)}
      >
        <IconQuote className="mt-0.75 shrink-0" />
        <span className={cn("min-w-0 leading-5 whitespace-pre-wrap", !open && "line-clamp-2")}>{quote.text}</span>
      </Button>
      {open && quote.source ? <span className="px-3 text-xs text-muted-foreground">From {quote.source}</span> : null}
      {quote.comment ? (
        <Bubble variant="muted" align="end" className="max-w-full">
          <BubbleContent
            dir="auto"
            className="rounded-xl rounded-tr-lg px-4 py-2 text-base leading-[1.6] whitespace-pre-wrap"
          >
            {quote.comment}
          </BubbleContent>
        </Bubble>
      ) : null}
    </div>
  )
}

export function QuoteCards(props: { comments: ReadonlyArray<SessionMessage.Quote> }) {
  return props.comments.map((quote) => (
    <QuoteCard key={`${quote.source}:${quote.text}:${quote.comment}`} quote={quote} />
  ))
}
