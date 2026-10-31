import { TimelineText } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Markdown } from "@ren/ui/markdown"
import { Marker, MarkerContent, MarkerIcon } from "@ren/ui/marker"
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react"
import { ToolIcons } from "./tool-icons.js"
import { TranscriptContext } from "./transcript-context.js"
import { Output, Step } from "./transcript-tool.js"

export function Separator(props: { label: string }) {
  return (
    <Marker variant="separator">
      <MarkerContent>{props.label}</MarkerContent>
    </Marker>
  )
}

export function Working(props: { label: string }) {
  return (
    <Marker>
      <MarkerContent className="shimmer motion-reduce:shimmer-none">{props.label}</MarkerContent>
    </Marker>
  )
}

export function TranscriptError(props: { kind?: string; text: string }) {
  const title = props.kind && TimelineText.errorTitle(props.kind)
  const parts = TimelineText.errorParts(props.text)
  const body = parts.body.trim()
  if (!title && !parts.head && !body) return null
  return (
    <div role="alert" className="flex min-w-0 flex-col gap-2">
      <Marker className="items-start text-destructive">
        <MarkerIcon>
          <IconAlertTriangle />
        </MarkerIcon>
        <MarkerContent className="whitespace-pre-wrap">
          {title ?? parts.head}
          {title || !body ? null : `\n${body}`}
        </MarkerContent>
      </Marker>
      {title ? (
        <Step icon={<IconInfoCircle />} title="Details">
          <Output text={props.text} failed />
        </Step>
      ) : null}
    </div>
  )
}

function Compaction(props: { message: SessionMessage.Compaction }) {
  const message = props.message
  const error = TimelineText.compactionError(message)
  const summary = message.status === "failed" ? "" : message.summary
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Separator label="Session compaction started" />
      {summary.trim() ? (
        <div data-searchable className="min-w-0">
          <Markdown streaming={message.status === "running"}>{summary}</Markdown>
        </div>
      ) : null}
      {message.status === "running" ? (
        <Working label={TimelineText.compaction(message)} />
      ) : (
        <Separator label={TimelineText.compaction(message)} />
      )}
      {error ? <TranscriptError text={error} /> : null}
    </div>
  )
}

const shellStatus = (message: SessionMessage.Shell) => {
  if (message.status === "running") return "running"
  return TimelineText.shellError(message) ? "error" : undefined
}

export function TranscriptShell(props: { message: SessionMessage.Shell }) {
  const message = props.message
  const error = TimelineText.shellError(message)
  const running = message.status === "running"
  const output = message.output?.output
  return (
    <Step
      icon={ToolIcons.of("command")}
      title={running ? "Running" : "Ran"}
      subject={message.command}
      status={shellStatus(message)}
    >
      <Output text={output ? TimelineText.shellOutput(output) : (error ?? "No output")} failed={Boolean(error)} />
    </Step>
  )
}

function ModelSwitched(props: { model: SessionModel.Ref }) {
  const name = TranscriptContext.useValue().state.modelNames.get(props.model.id) ?? props.model.id
  const variant = props.model.variant && props.model.variant !== "default" ? props.model.variant : undefined
  return <Separator label={variant ? `${name} · ${variant.charAt(0).toUpperCase()}${variant.slice(1)}` : name} />
}

export function TranscriptNotice(props: { message: SessionMessage.Info | undefined }) {
  const message = props.message
  if (!message) return null
  if (message.type === "compaction") return <Compaction message={message} />
  const notice = TimelineText.notice(message)
  if (!notice) return null
  if (message.type === "model-switched") return <ModelSwitched model={message.model} />
  return (
    <Marker>
      <MarkerContent>{notice.detail ? `${notice.title} · ${notice.detail}` : notice.title}</MarkerContent>
    </Marker>
  )
}

// oxlint-disable-next-line ren/no-comments -- Shown where a chat moved to a new machine and lost its workspace files (E117).
export function FilesReset() {
  return (
    <Alert>
      <IconInfoCircle />
      <AlertTitle>This chat moved to a new machine</AlertTitle>
      <AlertDescription>Workspace files from before this point are gone. The chat history is kept.</AlertDescription>
    </Alert>
  )
}
