import IconBrandGithub from "@tabler/icons-react-native/IconBrandGithub"
import IconBrandSlack from "@tabler/icons-react-native/IconBrandSlack"
import IconGitMerge from "@tabler/icons-react-native/IconGitMerge"
import IconGitPullRequest from "@tabler/icons-react-native/IconGitPullRequest"
import IconGitPullRequestClosed from "@tabler/icons-react-native/IconGitPullRequestClosed"
import IconGitPullRequestDraft from "@tabler/icons-react-native/IconGitPullRequestDraft"
import { ContextLevel } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { PullRequestState, SessionLinksInfo } from "@ren/client"
import { Channel } from "@ren/schema/channel"
import type { Session } from "@ren/schema/session"
import type { SessionModel } from "@ren/schema/session/model"
import { TaskLink } from "@ren/schema/task-link"
import { ErrorText } from "@ren/util/error-text"
import { NumberFormat } from "@ren/util/number-format"
import { useMutation, useQuery } from "@tanstack/react-query"
import { setStringAsync } from "expo-clipboard"
import { useRouter } from "expo-router"
import { openBrowserAsync } from "expo-web-browser"
import { useState } from "react"
import { type ColorValue, View } from "react-native"
import ArrowsPointingInIcon from "react-native-heroicons/mini/ArrowsPointingInIcon"
import ArchiveBoxIcon from "react-native-heroicons/mini/ArchiveBoxIcon"
import ClipboardDocumentCheckIcon from "react-native-heroicons/mini/ClipboardDocumentCheckIcon"
import EllipsisVerticalIcon from "react-native-heroicons/mini/EllipsisVerticalIcon"
import LinkIcon from "react-native-heroicons/mini/LinkIcon"
import PencilSquareIcon from "react-native-heroicons/mini/PencilSquareIcon"
import Svg, { Circle, Path, type SvgProps } from "react-native-svg"
import { withUniwind } from "uniwind"
import { Button } from "#components/button"
import { HeaderButton } from "#components/header-button"
import { Input } from "#components/input"
import { type MenuItem, MenuSheet, useMenuSheet } from "#components/menu-sheet"
import { Text } from "#components/text"
import { Api } from "#lib/api"
import { Auth } from "#lib/auth"

function LinearMark(props: SvgProps) {
  return (
    <Svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <Path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
    </Svg>
  )
}

function RingPrimitive(props: { readonly percent: number | undefined; readonly color?: ColorValue }) {
  const radius = 18.5
  const circumference = 2 * Math.PI * radius
  const fill = Math.min(100, props.percent ?? 0) / 100
  return (
    <View aria-hidden className="absolute inset-0 -rotate-90">
      <Svg viewBox="0 0 40 40" width={40} height={40} {...(props.color && { color: props.color })}>
        <Circle cx={20} cy={20} r={radius} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={2.5} />
        {fill > 0 ? (
          <Circle
            cx={20}
            cy={20}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={`${fill * circumference} ${circumference}`}
          />
        ) : null}
      </Svg>
    </View>
  )
}

const Ring = withUniwind(RingPrimitive, { color: { fromClassName: "className", styleProperty: "color" } })

const ringColors: Readonly<Record<ContextLevel.Level, string>> = {
  normal: "text-foreground",
  filling: "text-chart-3",
  full: "text-destructive",
}

function Row(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-sm text-muted-foreground">{props.label}</Text>
      <Text className="text-sm tabular-nums">{props.value}</Text>
    </View>
  )
}

function ContextSummary(props: { readonly sessionId: Session.ID; readonly usage: Usage; readonly open: boolean }) {
  const usage = props.usage
  const cost = useQuery({ ...Api.query.link.session.usage.queryOptions({ id: props.sessionId }), enabled: props.open })
  const level = ContextLevel.of(usage.percent)
  const words = ContextLevel.words[level]
  const total = cost.data?.total ?? 0
  const spent = total > 0 ? NumberFormat.microUsd(total) : "$0.00"
  const parts = [
    { label: "LLM", value: cost.data?.models ?? 0 },
    { label: "Tools", value: cost.data?.tools ?? 0 },
  ].filter((part) => part.value > 0)
  return (
    <View className="mx-5 mb-2 gap-1.5 rounded-xl bg-muted px-4 py-3">
      <Row
        label="Context"
        // ast-grep-ignore: no-nullish-comparison, -- 0% is a real context percentage
        value={`${NumberFormat.count(usage.tokens)}${usage.percent === undefined ? "" : ` (${usage.percent}%)`}`}
      />
      <Row label="Cost" value={cost.data ? spent : "—"} />
      {parts.map((part) => (
        <Row key={part.label} label={part.label} value={NumberFormat.microUsd(part.value)} />
      ))}
      {words ? <Text className={`text-xs ${ringColors[level]}`}>{words}</Text> : null}
    </View>
  )
}

const pullIcons: Readonly<Record<PullRequestState, MenuItem["icon"]>> = {
  open: IconGitPullRequest,
  draft: IconGitPullRequestDraft,
  merged: IconGitMerge,
  closed: IconGitPullRequestClosed,
}

const threadIcons: Readonly<Record<Channel.Provider, MenuItem["icon"]>> = {
  github: IconBrandGithub,
  linear: LinearMark,
  slack: IconBrandSlack,
}

interface Usage {
  readonly tokens: number
  readonly percent: number | undefined
}

const noLinks: SessionLinksInfo = { tasks: [], pullRequests: [], issues: [], threads: [] }

function RenameForm(props: { readonly sessionId: Session.ID; readonly title: string }) {
  const menu = useMenuSheet()
  const rename = ChatReact.useAction(props.sessionId, (opened, next: string) => opened.rename(next))
  const [title, setTitle] = useState(props.title)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState("")
  const save = () => {
    const next = title.trim()
    if (!next || next === props.title) return menu.close()
    setSaving(true)
    void rename(next).then(menu.close, (error: unknown) => {
      setSaving(false)
      setFailure(ErrorText.of(error, "Couldn’t rename the chat."))
    })
  }
  return (
    <View className="gap-3 px-5">
      <Text role="heading" aria-level={2} className="text-base font-semibold">
        Rename chat
      </Text>
      <Input
        value={title}
        aria-label="Chat title"
        selectTextOnFocus
        returnKeyType="done"
        invalid={Boolean(failure)}
        onChangeText={setTitle}
        onSubmitEditing={save}
      />
      {failure ? <Text className="text-sm text-destructive">{failure}</Text> : null}
      <View className="flex-row gap-2 pt-1">
        <Button variant="secondary" className="flex-1" disabled={saving} onPress={menu.close}>
          <Text>Cancel</Text>
        </Button>
        <Button className="flex-1" disabled={saving || !title.trim()} onPress={save}>
          <Text>Save</Text>
        </Button>
      </View>
    </View>
  )
}

function ChatActions(props: {
  readonly sessionId: Session.ID
  readonly title: string
  readonly capabilities: { readonly rename: boolean; readonly compact: boolean }
  readonly usage: Usage | undefined
  readonly model: SessionModel.Ref | undefined
  readonly onArchived: () => void
}) {
  const router = useRouter()
  const compact = ChatReact.useAction(props.sessionId, (opened, next: SessionModel.Ref | undefined) =>
    opened.compact(next),
  )
  const usage = props.usage
  const [open, setOpen] = useState(false)
  const archive = useMutation(Api.query.session.archive.mutationOptions())
  const links =
    useQuery({ ...Api.query.link.session.links.queryOptions({ id: props.sessionId }), enabled: open, staleTime: 0 })
      .data ?? noLinks
  const pulls = new Map(
    useQuery({
      ...Api.query.link.session.pullRequests.queryOptions({ id: props.sessionId }),
      enabled: open && links.pullRequests.length > 0,
      staleTime: 0,
    }).data?.map((pull) => [pull.url, pull]),
  )
  const url = `${Auth.webUrl}/sessions/${props.sessionId}`
  const items: ReadonlyArray<MenuItem> = [
    ...links.tasks.map((task) => ({
      key: task.id,
      group: "Tasks",
      label: task.title,
      detail: task.identifier,
      icon: ClipboardDocumentCheckIcon,
      onPress: () => router.push({ pathname: "/tasks/[id]", params: { id: task.id } }),
    })),
    ...links.pullRequests.map((pull) => {
      const info = pulls.get(pull.url)
      return {
        key: pull.url,
        group: "Pull requests",
        label: info?.title ?? TaskLink.label({ kind: "github_pr", url: pull.url }),
        detail: `#${pull.number}`,
        icon: pullIcons[info?.state ?? "open"],
        onPress: () => openBrowserAsync(pull.url),
      }
    }),
    ...links.issues.map((issue) => ({
      key: issue.url,
      group: "Issues",
      label: TaskLink.label(issue),
      detail: issue.kind === "github_issue" ? "GitHub" : "Linear",
      icon: issue.kind === "github_issue" ? IconBrandGithub : LinearMark,
      onPress: () => openBrowserAsync(issue.url),
    })),
    ...links.threads.map((thread) => ({
      key: thread.url,
      group: "Threads",
      label: thread.place
        ? `${thread.provider === "slack" ? "#" : ""}${thread.place}`
        : `${Channel.titles[thread.provider]} thread`,
      detail: Channel.titles[thread.provider],
      icon: threadIcons[thread.provider],
      onPress: () => openBrowserAsync(thread.url),
    })),
    ...(usage && props.capabilities.compact
      ? [{ label: "Compact chat", icon: ArrowsPointingInIcon, onPress: () => compact(props.model) }]
      : []),
    ...(props.capabilities.rename
      ? [
          {
            label: "Rename chat",
            icon: PencilSquareIcon,
            panel: <RenameForm sessionId={props.sessionId} title={props.title} />,
          },
        ]
      : []),
    { label: "Copy link", icon: LinkIcon, onPress: () => setStringAsync(url) },
    {
      label: "Archive chat",
      icon: ArchiveBoxIcon,
      confirm: {
        title: `Archive “${props.title}”?`,
        description: "It leaves your chat list. Only the API can bring it back.",
        action: "Archive",
      },
      onPress: () => archive.mutateAsync({ id: props.sessionId }).then(props.onArchived),
    },
  ]
  return (
    <>
      <HeaderButton
        icon={EllipsisVerticalIcon}
        // ast-grep-ignore: no-nullish-comparison, -- 0% is a real context percentage
        label={usage?.percent === undefined ? "Chat actions" : `Chat actions, context ${usage.percent}% used`}
        onPress={() => setOpen(true)}
      >
        {usage ? <Ring percent={usage.percent} className={ringColors[ContextLevel.of(usage.percent)]} /> : null}
      </HeaderButton>
      <MenuSheet
        open={open}
        title={props.title}
        header={usage ? <ContextSummary sessionId={props.sessionId} usage={usage} open={open} /> : null}
        items={items}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

export { ChatActions }
