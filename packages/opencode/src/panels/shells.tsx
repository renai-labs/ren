import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { Struct } from "effect"
import { createEffect, createResource, createSignal, For, on, onCleanup, Show } from "solid-js"
import { RenPanels } from "../panels.js"
import type { RenRpc } from "../rpc.js"

const kept = 256 * 1024

export function Shells(props: {
  readonly context: Plugin.Context
  readonly reader: Parameters<typeof RenPanels.shells>[0]
  readonly panel: PanelInput
  readonly shown: () => string | undefined
  readonly show: (shellID: string) => void
}) {
  const theme = props.context.theme
  const [listed, { refetch }] = createResource(
    () => props.panel.sessionID,
    (sessionID) => RenPanels.shells(props.reader, { sessionID }),
  )
  const [index, setIndex] = createSignal(0)
  const [followed, setFollowed] = createSignal<{
    readonly shell?: RenRpc.ShellInfo
    readonly output: string
    readonly error?: string
  }>({ output: "" })
  const running = () => {
    const value = listed()
    return value?.type === "ready" ? value.value.shells : []
  }
  const following: { token?: object | undefined; timer?: ReturnType<typeof setTimeout> } = {}
  const follow = (shellID: string | undefined) => {
    clearTimeout(following.timer)
    const token = {}
    following.token = token
    setFollowed({ output: "" })
    if (!shellID) return
    const tick = (cursor: number): Promise<void> =>
      RenPanels.output(props.reader, { sessionID: props.panel.sessionID, shellID, cursor }).then((read) => {
        if (following.token !== token) return
        if (read.type === "failed") return void setFollowed((now) => ({ ...now, error: read.message }))
        setFollowed((now) => ({ shell: read.value.shell, output: (now.output + read.value.output).slice(-kept) }))
        if (RenPanels.ended(read.value)) return void refetch()
        following.timer = setTimeout(() => void tick(read.value.cursor), read.value.cursor < read.value.size ? 0 : 1000)
      })
    void tick(0)
  }
  createEffect(on(props.shown, follow))
  onCleanup(() => {
    following.token = undefined
    clearTimeout(following.timer)
  })
  const [box, setBox] = createSignal<ScrollBoxRenderable>()
  const move = (by: number) => {
    setIndex((at) => Math.max(0, Math.min(running().length - 1, at + by)))
  }
  const stop = async () => {
    const shellID = followed().shell?.status === "running" ? followed().shell?.id : running()[index()]?.id
    if (!shellID) return
    const stopped = await RenPanels.stop(props.reader, { sessionID: props.panel.sessionID, shellID })
    if (stopped.type === "failed")
      props.context.ui.toast.show({ title: "Ren", message: stopped.message, variant: "error" })
    const shown = followed().shell
    if (stopped.type === "ready" && shown?.id === shellID) {
      following.token = undefined
      clearTimeout(following.timer)
      setFollowed((now) => ({ output: now.output, shell: Struct.assign(shown, { status: "killed" as const }) }))
    }
    void refetch()
  }
  const start = async () => {
    const command = await props.context.ui.dialog.prompt({ title: "Run on the hand", placeholder: "Command" })
    if (!command?.trim()) return
    const started = await RenPanels.run(props.reader, { sessionID: props.panel.sessionID, command: command.trim() })
    if (started.type === "failed")
      return props.context.ui.toast.show({ title: "Ren", message: started.message, variant: "error" })
    props.show(started.value.id)
    void refetch()
  }
  props.context.keymap.layer(() => ({
    commands: [
      { title: "Next", bind: "j", run: () => move(1) },
      { title: "Previous", bind: "k", run: () => move(-1) },
      {
        title: "Show",
        bind: "return",
        run: () => {
          const shell = running()[index()]
          if (shell) props.show(shell.id)
        },
      },
      { title: "Stop", bind: "x", run: () => void stop() },
      { title: "Run a command", bind: "n", run: () => void start() },
      { title: "Scroll down", bind: "pagedown", run: () => box()?.scrollBy(10) },
      { title: "Scroll up", bind: "pageup", run: () => box()?.scrollBy(-10) },
      { title: "Refresh", bind: "r", run: () => void refetch() },
      { title: "Full screen", bind: "f", run: props.panel.toggleFullscreen },
    ],
  }))
  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
        Ren shell · commands on the hand
      </text>
      <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
        j/k move · enter show · x stop · n run · r refresh · f full screen
      </text>
      <Show when={RenPanels.problem(listed())}>
        {(message) => <text fg={theme.text.feedback.error.base}>{message()}</text>}
      </Show>
      <Show when={listed()?.type === "ready" && running().length === 0}>
        <text fg={theme.text.muted}>No command runs on the hand.</text>
      </Show>
      <box flexDirection="column" flexShrink={0} maxHeight={8}>
        <For each={running()}>
          {(shell, at) => (
            <text
              fg={at() === index() ? theme.text.base : theme.text.muted}
              attributes={at() === index() ? TextAttributes.BOLD : 0}
              wrapMode="none"
            >
              {at() === index() ? "▸ " : "  "}
              {shell.command}
              {shell.sessionID === props.panel.sessionID ? "" : " · subagent"}
            </text>
          )}
        </For>
      </box>
      <Show when={followed().shell}>
        {(shell) => (
          <text fg={theme.text.base} marginTop={1} wrapMode="none">
            $ {shell().command} <span style={{ fg: theme.text.muted }}>· {RenPanels.status(shell())}</span>
          </text>
        )}
      </Show>
      <Show when={followed().error}>{(error) => <text fg={theme.text.feedback.error.base}>{error()}</text>}</Show>
      <scrollbox ref={setBox} flexGrow={1} stickyScroll stickyStart="bottom">
        <text fg={theme.text.base}>{followed().output}</text>
      </scrollbox>
    </box>
  )
}
