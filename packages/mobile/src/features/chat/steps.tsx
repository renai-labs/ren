import {
  type ChatAtoms,
  Family,
  PatchFiles,
  type TimelineDetail,
  TimelineOpen,
  TimelineText,
  ToolDisplay,
  ToolState,
  TranscriptBlocks,
} from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Shell } from "@ren/schema/shell"
import { cn } from "cn"
import { AsyncResult } from "effect/reactivity"
import { type ComponentProps, createContext, type ReactNode, use, useState } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import ChevronDownIcon from "react-native-heroicons/mini/ChevronDownIcon"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import ClockIcon from "react-native-heroicons/mini/ClockIcon"
import CommandLineIcon from "react-native-heroicons/mini/CommandLineIcon"
import DocumentIcon from "react-native-heroicons/mini/DocumentIcon"
import DocumentMagnifyingGlassIcon from "react-native-heroicons/mini/DocumentMagnifyingGlassIcon"
import DocumentTextIcon from "react-native-heroicons/mini/DocumentTextIcon"
import FolderIcon from "react-native-heroicons/mini/FolderIcon"
import GlobeAltIcon from "react-native-heroicons/mini/GlobeAltIcon"
import InformationCircleIcon from "react-native-heroicons/mini/InformationCircleIcon"
import LightBulbIcon from "react-native-heroicons/mini/LightBulbIcon"
import PencilIcon from "react-native-heroicons/mini/PencilIcon"
import PowerIcon from "react-native-heroicons/mini/PowerIcon"
import QueueListIcon from "react-native-heroicons/mini/QueueListIcon"
import WrenchIcon from "react-native-heroicons/mini/WrenchIcon"
import { CodeBlock } from "#components/code-block"
import { Icon } from "#components/icon"
import { Markdown } from "#components/markdown"
import { Text } from "#components/text"

type Step = TranscriptBlocks.Step

const toolIcons = {
  command: CommandLineIcon,
  file: DocumentIcon,
  edit: DocumentTextIcon,
  search: DocumentMagnifyingGlassIcon,
  web: GlobeAltIcon,
  agent: QueueListIcon,
  ren: PowerIcon,
  tool: PowerIcon,
} satisfies Record<ToolDisplay.Kind, unknown>

const groupIcons = { context: WrenchIcon, read: FolderIcon, file: PencilIcon }

interface Timeline {
  readonly view: ChatAtoms.View
  readonly detail: TimelineDetail.Detail
}

const TimelineContext = createContext<Timeline | null>(null)

const OpenContext = createContext(false)

function StepsProvider(props: {
  readonly root: Session.ID
  readonly detail: TimelineDetail.Detail
  readonly children: ReactNode
}) {
  return (
    <TimelineContext value={{ view: { root: props.root, sessionID: props.root }, detail: props.detail }}>
      {props.children}
    </TimelineContext>
  )
}

function useTimeline() {
  const timeline = use(TimelineContext)
  if (!timeline) throw new Error("Steps must be used inside StepsProvider")
  return timeline
}

function StepLine(props: {
  readonly icon: ComponentProps<typeof Icon>["as"]
  readonly title: string
  readonly subtitle?: string | undefined
  readonly mono?: boolean
  readonly trailing?: string | undefined
  readonly running?: boolean
  readonly failed?: boolean
  readonly children?: ReactNode
}) {
  const initial = use(OpenContext)
  const [open, setOpen] = useState(initial)
  const expandable = Boolean(props.children)
  const tone = props.failed ? "text-destructive" : "text-muted-foreground"
  return (
    <View className="gap-2">
      <Pressable
        role={expandable ? "button" : undefined}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className="flex-row items-center gap-2 self-start"
        onPress={() => setOpen(!open)}
      >
        {props.running ? (
          <ActivityIndicator colorClassName="accent-muted-foreground" size="small" className="size-4" />
        ) : (
          <Icon as={props.icon} className={cn("size-4", tone)} />
        )}
        <Text className={cn("shrink-0 text-sm", tone)}>{props.title}</Text>
        {props.subtitle ? (
          <Text
            className={cn("shrink text-muted-foreground/70", props.mono ? "font-mono text-xs" : "text-sm")}
            numberOfLines={1}
          >
            {props.subtitle}
          </Text>
        ) : null}
        {props.trailing ? <Text className="shrink-0 text-sm text-muted-foreground/70">{props.trailing}</Text> : null}
        {expandable ? (
          <Icon as={open ? ChevronDownIcon : ChevronRightIcon} className="size-4 text-muted-foreground" />
        ) : null}
      </Pressable>
      {open ? <View className="gap-2 pl-6">{props.children}</View> : null}
    </View>
  )
}

function Output(props: {
  readonly command: string | undefined
  readonly output: string | undefined
  readonly failed: boolean
}) {
  if (!props.command && !props.output) return null
  const text = [props.command && `$ ${props.command}`, props.output].filter(Boolean).join("\n")
  return <CodeBlock tone={props.failed ? "destructive" : undefined}>{text}</CodeBlock>
}

function LiveShell(props: { readonly tool: SessionMessage.Tool; readonly shellID: Shell.ID }) {
  const view = useTimeline().view
  const live = ChatReact.useShellRunning(view.root, props.shellID)
  const running = props.tool.state.status === "streaming" || props.tool.state.status === "running" || live
  const streamed = AsyncResult.getOrElse(
    ChatReact.useShellOutput({ ...view, shellID: props.shellID, running }),
    () => "",
  )
  const failed = !running && ToolDisplay.status(props.tool) === "failed"
  const command = ToolDisplay.command(props.tool)
  const output = streamed ? TimelineText.shellOutput(streamed) : ToolDisplay.output(props.tool)
  return (
    <StepLine
      icon={CommandLineIcon}
      title={ToolDisplay.shellLabel(props.tool, { running })}
      subtitle={ToolDisplay.subtitle(props.tool)}
      mono
      running={running}
      failed={failed}
    >
      {command || output ? <Output command={command} output={output} failed={failed} /> : undefined}
    </StepLine>
  )
}

function SubagentStep(props: { readonly tool: SessionMessage.Tool }) {
  const card = ChatReact.useSubagentCard(useTimeline().view, props.tool)
  const running = card.status === "running" || card.status === "delegating"
  const error = card.status === "failed" ? (ToolDisplay.error(props.tool) ?? ToolDisplay.output(props.tool)) : undefined
  const description = card.description ?? card.title
  return (
    <StepLine
      icon={toolIcons.agent}
      title={Family.subagentTitle(card)}
      subtitle={running && card.activity ? `${description} · ${card.activity}` : description}
      running={running}
      failed={card.status === "failed"}
    >
      {error ? <CodeBlock tone="destructive">{error}</CodeBlock> : undefined}
    </StepLine>
  )
}

function ToolStep(props: { readonly tool: SessionMessage.Tool }) {
  const tool = props.tool
  const shellID = ToolState.liveShellID(tool)
  if (shellID) return <LiveShell tool={tool} shellID={shellID} />
  if (tool.name === "subagent" || tool.name === "task") return <SubagentStep tool={tool} />
  const status = ToolDisplay.status(tool)
  const icon = toolIcons[ToolDisplay.kind(tool)]
  const changed =
    PatchFiles.isFileChange(tool) && status === "completed" ? PatchFiles.patchFiles(PatchFiles.toolFiles(tool)) : []
  if (changed.length > 0) {
    const additions = changed.reduce((total, file) => total + file.additions, 0)
    const deletions = changed.reduce((total, file) => total + file.deletions, 0)
    return (
      <StepLine
        icon={icon}
        title={ToolDisplay.label(tool)}
        subtitle={ToolDisplay.subtitle(tool)}
        mono
        trailing={`+${additions} −${deletions}`}
      />
    )
  }
  const command = ToolDisplay.command(tool)
  const output = ToolDisplay.error(tool) ?? ToolDisplay.output(tool)
  return (
    <StepLine
      icon={icon}
      title={ToolDisplay.label(tool)}
      subtitle={[ToolDisplay.subtitle(tool), ToolDisplay.matches(tool)].filter(Boolean).join(" · ")}
      mono
      running={status === "running"}
      failed={status === "failed"}
    >
      {command || output ? <Output command={command} output={output} failed={status === "failed"} /> : undefined}
    </StepLine>
  )
}

function ShellStep(props: { readonly message: SessionMessage.Shell }) {
  const message = props.message
  const running = message.status === "running"
  const error = TimelineText.shellError(message)
  const output = message.output?.output ? TimelineText.shellOutput(message.output.output) : (error ?? "No output")
  const finished = error ? "Failed to run" : "Ran"
  return (
    <StepLine
      icon={CommandLineIcon}
      title={running ? "Running" : finished}
      subtitle={message.command}
      mono
      running={running}
      failed={Boolean(error)}
    >
      <Output command={message.command} output={output} failed={Boolean(error)} />
    </StepLine>
  )
}

function GroupStep(props: { readonly step: Extract<Step, { kind: "group" }> }) {
  const detail = useTimeline().detail
  const items = TranscriptBlocks.groupItems(props.step)
  const open = props.step.type === "file" && detail.edit.details === "expanded"
  if (ToolDisplay.standsAlone(items)) return props.step.steps.map((step) => <StepItem key={step.key} step={step} />)
  return (
    <OpenContext key={String(open)} value={open}>
      <StepLine
        icon={groupIcons[props.step.type]}
        title={TranscriptBlocks.groupTitle(props.step, items)}
        running={TranscriptBlocks.leaves(props.step.steps).some(TranscriptBlocks.running)}
      >
        <StepRuns steps={props.step.steps} />
      </StepLine>
    </OpenContext>
  )
}

function stepOpen(step: Exclude<Step, { kind: "group" | "text" }>, detail: TimelineDetail.Detail) {
  if (step.kind === "reasoning") return TimelineOpen.defaultOpen(step.content, detail)
  if (step.kind === "tool") return TimelineOpen.defaultOpen(step.tool, detail)
  return step.kind === "shell" && detail.shell.details === "expanded"
}

function StepItem(props: { readonly step: Step }) {
  const step = props.step
  const detail = useTimeline().detail
  if (step.kind === "group") return <GroupStep step={step} />
  if (step.kind === "text") return <Markdown text={step.text} streaming={step.streaming} size="sm" />
  const open = stepOpen(step, detail)
  return (
    <OpenContext key={String(open)} value={open}>
      <StepBody step={step} />
    </OpenContext>
  )
}

function StepBody(props: { readonly step: Exclude<Step, { kind: "group" | "text" }> }) {
  const step = props.step
  if (step.kind === "tool") return <ToolStep tool={step.tool} />
  if (step.kind === "shell") return <ShellStep message={step.message} />
  if (step.kind === "reasoning") {
    const text = step.content.text.trim()
    return (
      <StepLine icon={LightBulbIcon} title={step.running ? "Thinking" : "Thought"} running={step.running}>
        {text ? <Markdown text={text} streaming={step.running} size="sm" /> : undefined}
      </StepLine>
    )
  }
  const notice = TimelineText.notice(step.message)
  if (!notice) return null
  return <StepLine icon={InformationCircleIcon} title={notice.title} subtitle={notice.detail} />
}

function StepRuns(props: { readonly steps: ReadonlyArray<Step> }) {
  return (
    <View className="gap-3">
      {props.steps.map((step) => (
        <StepItem key={step.key} step={step} />
      ))}
    </View>
  )
}

function Steps(props: { readonly steps: ReadonlyArray<Step>; readonly workedFor: string | undefined }) {
  const background = (step: Step) => step.kind === "tool" && ToolState.backgrounded(step.tool)
  const steps = props.steps.filter((step) => !background(step))
  const count = TranscriptBlocks.count(steps)
  return (
    <View className="gap-3">
      {steps.length > 0 ? (
        <StepLine
          icon={ClockIcon}
          title={props.workedFor ? `Worked for ${props.workedFor}` : "Worked"}
          subtitle={count === 1 ? "1 step" : `${count} steps`}
        >
          <StepRuns steps={steps} />
        </StepLine>
      ) : null}
      {props.steps.filter(background).map((step) => (
        <StepItem key={step.key} step={step} />
      ))}
    </View>
  )
}

export { Steps, StepRuns, StepsProvider }
