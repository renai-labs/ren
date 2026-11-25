import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { TextAttributes } from "@opentui/core"
import { createResource, createSignal, For, Show } from "solid-js"
import { RenPanels } from "../panels.js"
import type { RenRpc } from "../rpc.js"

export function Activity(props: {
  readonly context: Plugin.Context
  readonly reader: Parameters<typeof RenPanels.activity>[0]
  readonly panel: PanelInput
  readonly background: () => Promise<void>
  readonly show: (shellID: string) => void
}) {
  const theme = props.context.theme
  const [listed, { refetch }] = createResource(
    () => props.panel.sessionID,
    (sessionID) => RenPanels.activity(props.reader, { sessionID }),
  )
  const [index, setIndex] = createSignal(0)
  const items = () => {
    const value = listed()
    return value?.type === "ready" ? value.value.items : []
  }
  const selected = () => items()[Math.min(index(), items().length - 1)]
  const move = (by: number) => {
    setIndex((at) => Math.max(0, Math.min(items().length - 1, at + by)))
  }
  const stop = async (work: RenRpc.Work | undefined) => {
    if (!work?.id) return
    const sessionID = props.panel.sessionID
    const stopped =
      work.type === "shell"
        ? await RenPanels.stop(props.reader, { sessionID, shellID: work.id })
        : await RenPanels.stopSubagent(props.reader, { sessionID, childID: work.id })
    if (stopped.type === "failed")
      props.context.ui.toast.show({ title: "Ren", message: stopped.message, variant: "error" })
    void refetch()
  }
  props.context.keymap.layer(() => ({
    commands: [
      { title: "Next", bind: "j", run: () => move(1) },
      { title: "Previous", bind: "k", run: () => move(-1) },
      { title: "Stop", bind: "x", run: () => void stop(selected()) },
      { title: "Background", bind: "b", run: () => void props.background().then(() => refetch()) },
      {
        title: "Show output",
        bind: "return",
        run: () => {
          const work = selected()
          if (work?.type === "shell" && work.id) props.show(work.id)
        },
      },
      { title: "Refresh", bind: "r", run: () => void refetch() },
      { title: "Full screen", bind: "f", run: props.panel.toggleFullscreen },
    ],
  }))
  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
        Ren activity · shells and subagents that run
      </text>
      <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
        j/k move · x stop · b background · enter output · r refresh · f full screen
      </text>
      <Show when={RenPanels.problem(listed())}>
        {(message) => <text fg={theme.text.feedback.error.base}>{message()}</text>}
      </Show>
      <Show when={listed()?.type === "ready" && items().length === 0}>
        <text fg={theme.text.muted}>Nothing runs.</text>
      </Show>
      <scrollbox flexGrow={1}>
        <For each={items()}>
          {(work, at) => (
            <text
              fg={at() === index() ? theme.text.base : theme.text.muted}
              attributes={at() === index() ? TextAttributes.BOLD : 0}
              wrapMode="none"
            >
              {at() === index() ? "▸ " : "  "}
              {work.type === "shell" ? "$ " : "@ "}
              {work.label || (work.type === "shell" ? "Command" : "Subagent")}
              <span style={{ fg: theme.text.muted }}>{work.blocking ? " · the turn waits for it" : ""}</span>
            </text>
          )}
        </For>
      </scrollbox>
    </box>
  )
}
