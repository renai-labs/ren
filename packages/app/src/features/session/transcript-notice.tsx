import { TimelineText } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import { Icon } from "@ren/ui/icon"
import { List } from "@ren/ui/list"
import { Notice } from "@ren/ui/notice"
import { Separator } from "@ren/ui/separator"
import { Text } from "@ren/ui/text"
import { Transcript } from "@ren/ui/transcript"

export function TranscriptError(props: { text: string }) {
  const parts = TimelineText.errorParts(props.text)
  return (
    <Notice tone="danger" title={parts.head || undefined}>
      {parts.body.trim()}
    </Notice>
  )
}

function Compaction(props: { message: SessionMessage.Compaction }) {
  const message = props.message
  const error = TimelineText.compactionError(message)
  const summary = message.status === "failed" ? "" : message.summary
  return (
    <>
      <Separator label="Session compaction started" />
      {summary.trim() ? <Transcript.Response content={summary} streaming={message.status === "running"} /> : null}
      {message.status === "running" ? (
        <Transcript.Working label={TimelineText.compaction(message)} />
      ) : (
        <Separator label={TimelineText.compaction(message)} />
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
    <List.TranscriptItem
      leading={<Icon glyph="Info" />}
      title={notice.title}
      {...(notice.detail && { description: notice.detail })}
    />
  )
}

export function TranscriptNotice(props: { message: SessionMessage.Info | undefined }) {
  const message = props.message
  if (!message) return null
  if (message.type === "compaction") return <Compaction message={message} />
  const notice = TimelineText.notice(message)
  if (!notice) return null
  if (message.type === "model-switched") return <Separator label={notice.title} />
  return (
    <Text purpose="caption" tone="secondary">
      {notice.detail ? `${notice.title} · ${notice.detail}` : notice.title}
    </Text>
  )
}
