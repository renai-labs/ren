import { type ChatAtoms, TimelineText, ToolDisplay, ToolState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { SessionMessage } from "@ren/schema/session-message"
import type { Shell } from "@ren/schema/shell"
import { List } from "@ren/ui/list"
import { Transcript } from "@ren/ui/transcript"
import { AsyncResult } from "effect/reactivity"

function ToolRow(props: {
  tool: SessionMessage.Tool
  status: ToolDisplay.Status
  output: string | undefined
  follow: boolean
}) {
  const tool = props.tool
  const kind = ToolDisplay.kind(tool)
  const error = ToolDisplay.error(tool)
  const code = kind === "command" ? "code" : "text"
  return (
    <Transcript.Tool
      kind={kind}
      title={ToolDisplay.label(tool)}
      subtitle={ToolDisplay.subtitle(tool)}
      status={props.status}
      failure={error ? ToolDisplay.errorSummary(tool.name, error) : undefined}
      defaultOpen={ToolState.defaultOpen(tool, false, false) ?? false}
    >
      <Transcript.ToolDetail label="Input" value={JSON.stringify(ToolState.input(tool), null, 2)} appearance={code} />
      {props.status !== "failed" && (props.output || props.status === "completed") ? (
        <Transcript.ToolDetail
          label="Output"
          value={props.output ?? "No output"}
          appearance={code}
          follow={props.follow}
        />
      ) : null}
      {error ? <Transcript.ToolDetail label="Error" value={error} /> : null}
    </Transcript.Tool>
  )
}

function ShellTool(props: { tool: SessionMessage.Tool; view: ChatAtoms.View; shellID: Shell.ID }) {
  const pending = props.tool.state.status === "streaming" || props.tool.state.status === "running"
  const live = ChatReact.useShellRunning(props.view.root, props.shellID)
  const running = pending || live
  const streamed = ChatReact.useShellOutput({ ...props.view, shellID: props.shellID, running })
  const text = AsyncResult.getOrElse(streamed, () => "")
  return (
    <ToolRow
      tool={props.tool}
      status={running ? "running" : ToolDisplay.status(props.tool)}
      output={text ? TimelineText.shellOutput(text) : ToolDisplay.output(props.tool)}
      follow={running}
    />
  )
}

export function TranscriptTool(props: { tool: SessionMessage.Tool; view: ChatAtoms.View | undefined }) {
  const tool = props.tool
  if (ToolDisplay.hidden(tool)) return null
  if (ToolDisplay.dismissed(tool)) return <List.TranscriptItem appearance="event" title="Questions dismissed" />
  const shellID = ToolState.liveShellID(tool)
  if (shellID && props.view) return <ShellTool tool={tool} view={props.view} shellID={shellID} />
  return <ToolRow tool={tool} status={ToolDisplay.status(tool)} output={ToolDisplay.output(tool)} follow={false} />
}
