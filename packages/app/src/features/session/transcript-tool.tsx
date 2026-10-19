import { ToolDisplay, ToolState } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session-message"
import { List } from "@ren/ui/list"
import { Transcript } from "@ren/ui/transcript"

export function TranscriptTool(props: { tool: SessionMessage.Tool }) {
  const tool = props.tool
  if (ToolDisplay.hidden(tool)) return null
  if (ToolDisplay.dismissed(tool)) return <List.TranscriptItem appearance="event" title="Questions dismissed" />
  const status = ToolDisplay.status(tool)
  const kind = ToolDisplay.kind(tool)
  const error = ToolDisplay.error(tool)
  const output = ToolDisplay.output(tool)
  const code = kind === "command" ? "code" : "text"
  return (
    <Transcript.Tool
      kind={kind}
      title={ToolDisplay.label(tool)}
      subtitle={ToolDisplay.subtitle(tool)}
      status={status}
      failure={error ? ToolDisplay.errorSummary(tool.name, error) : undefined}
      defaultOpen={ToolState.defaultOpen(tool, false, false) ?? false}
    >
      <Transcript.ToolDetail label="Input" value={JSON.stringify(ToolState.input(tool), null, 2)} appearance={code} />
      {status !== "failed" && (output || status === "completed") ? (
        <Transcript.ToolDetail label="Output" value={output ?? "No output"} appearance={code} />
      ) : null}
      {error ? <Transcript.ToolDetail label="Error" value={error} /> : null}
    </Transcript.Tool>
  )
}
