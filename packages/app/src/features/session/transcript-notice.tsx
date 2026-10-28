import { TimelineText } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Icon } from "@ren/ui/icon"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Separator } from "@ren/ui/separator"
import { Text } from "@ren/ui/text"
import { Transcript } from "@ren/ui/transcript"

export function LabeledSeparator(props: { label: string }) {
  return (
    <div className="flex w-full items-center gap-3">
      <Separator className="min-w-0 flex-1" />
      <span className="shrink-0 text-xs font-medium text-muted-foreground uppercase">{props.label}</span>
      <Separator aria-hidden className="min-w-0 flex-1" />
    </div>
  )
}

export function TranscriptError(props: { kind?: string; text: string }) {
  const title = props.kind && TimelineText.errorTitle(props.kind)
  if (title)
    return (
      <Alert variant="destructive">
        <Icon glyph="AlertCircle" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          <Collapsible className="flex min-w-0 flex-col">
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="-mx-2 self-start text-muted-foreground [&_svg]:transition-transform data-panel-open:[&_svg]:rotate-90"
                />
              }
            >
              <Icon glyph="ChevronRight" data-icon="inline-start" />
              Details
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <Text purpose="caption" tone="secondary" wrapping="anywhere">
                {props.text}
              </Text>
            </CollapsibleContent>
          </Collapsible>
        </AlertDescription>
      </Alert>
    )
  const parts = TimelineText.errorParts(props.text)
  const body = parts.body.trim()
  if (!parts.head && !body) return null
  return (
    <Alert variant="destructive">
      <Icon glyph="AlertCircle" />
      {parts.head ? <AlertTitle>{parts.head}</AlertTitle> : null}
      {body ? <AlertDescription>{body}</AlertDescription> : null}
    </Alert>
  )
}

function Compaction(props: { message: SessionMessage.Compaction }) {
  const message = props.message
  const error = TimelineText.compactionError(message)
  const summary = message.status === "failed" ? "" : message.summary
  return (
    <>
      <LabeledSeparator label="Session compaction started" />
      {summary.trim() ? <Transcript.Response content={summary} streaming={message.status === "running"} /> : null}
      {message.status === "running" ? (
        <Transcript.Working label={TimelineText.compaction(message)} />
      ) : (
        <LabeledSeparator label={TimelineText.compaction(message)} />
      )}
      {error ? <TranscriptError text={error} /> : null}
    </>
  )
}

export function TranscriptShell(props: { message: SessionMessage.Shell }) {
  const message = props.message
  const error = TimelineText.shellError(message)
  const running = message.status === "running"
  const output = message.output?.output
  const settled = error ? "failed" : "completed"
  return (
    <Transcript.Tool
      kind="command"
      title={running ? "Running" : "Ran"}
      subtitle={message.command}
      status={running ? "running" : settled}
      defaultOpen={Boolean(error)}
    >
      <Transcript.ToolDetail
        label="Output"
        value={output ? TimelineText.shellOutput(output) : "No output"}
        appearance="code"
      />
      {error ? <Transcript.ToolDetail label="Error" value={error} /> : null}
    </Transcript.Tool>
  )
}

export function TranscriptNoticeItem(props: { message: SessionMessage.Info }) {
  if (props.message.type === "shell") return <TranscriptShell message={props.message} />
  const notice = TimelineText.notice(props.message)
  if (!notice) return null
  return (
    <Item
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the transcript list is a div with role="list", so its rows are divs too
      role="listitem"
      size="xs"
      className="items-start px-2 py-1 text-muted-foreground"
    >
      <ItemMedia variant="icon" className="h-6">
        <Icon glyph="Info" />
      </ItemMedia>
      <ItemContent className="min-w-0 flex-row items-center gap-2">
        <ItemTitle className="max-w-1/2 shrink-0 truncate font-normal">{notice.title}</ItemTitle>
        {notice.detail ? <ItemDescription className="truncate text-xs">{notice.detail}</ItemDescription> : null}
      </ItemContent>
    </Item>
  )
}

export function TranscriptNotice(props: { message: SessionMessage.Info | undefined }) {
  const message = props.message
  if (!message) return null
  if (message.type === "compaction") return <Compaction message={message} />
  const notice = TimelineText.notice(message)
  if (!notice) return null
  if (message.type === "model-switched") return <LabeledSeparator label={notice.title} />
  return (
    <Text purpose="caption" tone="secondary">
      {notice.detail ? `${notice.title} · ${notice.detail}` : notice.title}
    </Text>
  )
}

// oxlint-disable-next-line ren/no-comments -- Shown where a chat moved to a new machine and lost its workspace files (E117).
export function FilesReset() {
  return (
    <Alert>
      <Icon glyph="Info" tone="secondary" />
      <AlertTitle>This chat moved to a new machine</AlertTitle>
      <AlertDescription>Workspace files from before this point are gone. The chat history is kept.</AlertDescription>
    </Alert>
  )
}
