import { type ChatAtoms, PatchFiles, TimelineText, ToolDisplay, ToolState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { SessionMessage } from "@ren/schema/session-message"
import type { Shell } from "@ren/schema/shell"
import { ImagePreview } from "@ren/ui/image-preview"
import { List } from "@ren/ui/list"
import { Transcript } from "@ren/ui/transcript"
import { AsyncResult } from "effect/reactivity"

const changes: Readonly<Record<PatchFiles.Kind, Transcript.FileChangeKind>> = {
  add: "created",
  delete: "deleted",
  update: "modified",
}

export function FileChanges(props: {
  tools: ReadonlyArray<SessionMessage.Tool>
  placement?: "block" | "list-item"
  open?: boolean
}) {
  const groups = PatchFiles.groups(props.tools)
  if (groups.length === 0) return null
  return (
    <Transcript.FileChanges
      placement={props.placement ?? "block"}
      defaultOpen={props.open ? groups.map((group) => group.path) : []}
    >
      {groups.map((group) => (
        <Transcript.FileChange
          key={group.path}
          path={group.path}
          change={changes[group.type]}
          additions={group.additions}
          deletions={group.deletions}
        >
          {group.views.map((view) => (
            <Transcript.Diff key={view.diff.cacheKey} file={view.file} hunks={view.diff.hunks} />
          ))}
        </Transcript.FileChange>
      ))}
    </Transcript.FileChanges>
  )
}

const images = (tool: SessionMessage.Tool) =>
  "content" in tool.state
    ? tool.state.content.flatMap((item) =>
        item.type === "file" && item.mime.startsWith("image/") && /^(data:|https?:)/.test(item.uri) ? [item] : [],
      )
    : []

const subtitleOf = (tool: SessionMessage.Tool) => {
  const subject = ToolDisplay.subtitle(tool)
  if (tool.name === "shell" && tool.state.status === "streaming" && !subject) return "Writing command…"
  const matches = ToolDisplay.matches(tool)
  return matches ? [subject, matches].filter(Boolean).join(" · ") : subject
}

function ToolBody(props: {
  tool: SessionMessage.Tool
  status: ToolDisplay.Status
  output: string | undefined
  follow: boolean
}) {
  const tool = props.tool
  const code = ToolDisplay.kind(tool) === "command" ? "code" : "text"
  const error = ToolDisplay.error(tool)
  const answers = ToolDisplay.answers(tool)
  const links = ToolDisplay.links(tool)
  const files = PatchFiles.isFileChange(tool) ? <FileChanges tools={[tool]} open /> : null
  return (
    <>
      {files ?? (
        <Transcript.ToolDetail label="Input" value={JSON.stringify(ToolState.input(tool), null, 2)} appearance={code} />
      )}
      {answers.length > 0 ? <Transcript.Answers items={answers} /> : null}
      {links.length > 0 ? <Transcript.Links label="Search results" links={links} /> : null}
      {images(tool).map((image) => (
        <ImagePreview
          key={image.uri}
          source={image.uri}
          description={image.name ?? ToolDisplay.subtitle(tool) ?? "Image"}
        />
      ))}
      {!files && props.status !== "failed" && (props.output || props.status === "completed") ? (
        <Transcript.ToolDetail
          label="Output"
          value={props.output ?? "No output"}
          appearance={code}
          follow={props.follow}
        />
      ) : null}
      {error ? <Transcript.ToolDetail label="Error" value={error} /> : null}
    </>
  )
}

function ToolRow(props: {
  tool: SessionMessage.Tool
  status: ToolDisplay.Status
  output: string | undefined
  follow: boolean
  open?: boolean
}) {
  const tool = props.tool
  const error = ToolDisplay.error(tool)
  const loaded = ToolDisplay.loaded(tool)
  return (
    <>
      <Transcript.Tool
        kind={ToolDisplay.kind(tool)}
        title={ToolDisplay.label(tool)}
        subtitle={subtitleOf(tool)}
        status={props.status}
        failure={error ? ToolDisplay.errorSummary(tool.name, error) : undefined}
        defaultOpen={
          props.open === true ||
          ToolDisplay.answers(tool).length > 0 ||
          (ToolState.defaultOpen(tool, false, false) ?? false)
        }
      >
        <ToolBody tool={tool} status={props.status} output={props.output} follow={props.follow} />
      </Transcript.Tool>
      {loaded.length > 0 ? (
        <List.TranscriptItem
          appearance="event"
          title={`Loaded ${loaded.join(", ")}`}
          label={`Loaded ${loaded.join(", ")}`}
        />
      ) : null}
    </>
  )
}

function ShellTool(props: { tool: SessionMessage.Tool; view: ChatAtoms.View; shellID: Shell.ID; open: boolean }) {
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
      open={props.open}
    />
  )
}

export function TranscriptTool(props: { tool: SessionMessage.Tool; view: ChatAtoms.View | undefined; open?: boolean }) {
  const tool = props.tool
  if (ToolDisplay.hidden(tool)) return null
  if (ToolDisplay.dismissed(tool)) return <List.TranscriptItem appearance="event" title="Questions dismissed" />
  const shellID = ToolState.liveShellID(tool)
  if (shellID && props.view)
    return <ShellTool tool={tool} view={props.view} shellID={shellID} open={props.open === true} />
  return (
    <ToolRow
      tool={tool}
      status={ToolDisplay.status(tool)}
      output={ToolDisplay.output(tool)}
      follow={false}
      open={props.open === true}
    />
  )
}
