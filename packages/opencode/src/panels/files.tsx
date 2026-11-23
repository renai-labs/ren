import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { type ScrollBoxRenderable, type SyntaxStyle, TextAttributes } from "@opentui/core"
import { createResource, createSignal, For, Show } from "solid-js"
import { RenPanels } from "../panels.js"
import type { RenRpc } from "../rpc.js"

export function Files(props: {
  readonly context: Plugin.Context
  readonly reader: Parameters<typeof RenPanels.list>[0]
  readonly panel: PanelInput
  readonly syntax: SyntaxStyle
}) {
  const theme = props.context.theme
  const [folder, setFolder] = createSignal("")
  const [open, setOpen] = createSignal<string>()
  const [index, setIndex] = createSignal(0)
  const [listed, { refetch }] = createResource(
    () => ({ sessionID: props.panel.sessionID, folder: folder() }),
    (input) =>
      RenPanels.list(props.reader, { sessionID: input.sessionID, ...(input.folder && { path: input.folder }) }),
  )
  const [file] = createResource(
    () => {
      const path = open()
      return path ? { sessionID: props.panel.sessionID, path } : undefined
    },
    (input) => RenPanels.read(props.reader, input),
  )
  const entries = (): ReadonlyArray<RenRpc.Entry> => {
    const value = listed()
    const found = value?.type === "ready" ? value.value.entries : []
    return folder() ? [{ path: RenPanels.parent(folder()), type: "directory" }, ...found] : found
  }
  const [box, setBox] = createSignal<ScrollBoxRenderable>()
  const go = (entry: RenRpc.Entry | undefined) => {
    if (entry?.type === "file") setOpen(entry.path)
    if (entry?.type !== "directory") return
    setIndex(0)
    setFolder(entry.path)
  }
  const [list, setList] = createSignal<ScrollBoxRenderable>()
  const move = (by: number) => {
    const next = Math.max(0, Math.min(entries().length - 1, index() + by))
    setIndex(next)
    list()?.scrollChildIntoView(`ren-file-${next}`)
  }
  const back = () => {
    if (open()) setOpen(undefined)
    else if (folder()) go({ path: RenPanels.parent(folder()), type: "directory" })
  }
  const find = async () => {
    const query = await props.context.ui.dialog.prompt({ title: "Search the hand’s files", placeholder: "Path" })
    if (!query?.trim()) return
    const found = await RenPanels.search(props.reader, { sessionID: props.panel.sessionID, query: query.trim() })
    if (found.type === "failed")
      return props.context.ui.toast.show({ title: "Ren", message: found.message, variant: "error" })
    const chosen = await props.context.ui.dialog.select({
      title: "Files on the hand",
      options: found.value.entries.map((entry) => ({ title: entry.path, value: entry })),
    })
    go(chosen)
  }
  props.context.keymap.layer(() => ({
    commands: [
      { title: "Next", bind: "j", run: () => move(1) },
      { title: "Next", bind: "down", run: () => move(1) },
      { title: "Previous", bind: "k", run: () => move(-1) },
      { title: "Previous", bind: "up", run: () => move(-1) },
      { title: "Open", bind: "return", run: () => go(open() ? undefined : entries()[index()]) },
      { title: "Back", bind: "backspace", run: back },
      { title: "Back", bind: "h", run: back },
      { title: "Search", bind: "/", run: () => void find() },
      { title: "Scroll down", bind: "pagedown", run: () => box()?.scrollBy(10) },
      { title: "Scroll up", bind: "pageup", run: () => box()?.scrollBy(-10) },
      { title: "Refresh", bind: "r", run: () => void refetch() },
      { title: "Full screen", bind: "f", run: props.panel.toggleFullscreen },
    ],
  }))
  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
        Ren files · {open() ?? (folder() || "session folder")}
      </text>
      <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
        j/k move · enter open · backspace back · / search · r refresh · f full screen
      </text>
      <Show when={RenPanels.problem(listed())}>
        {(message) => <text fg={theme.text.feedback.error.base}>{message()}</text>}
      </Show>
      <Show
        when={open()}
        fallback={
          <scrollbox ref={setList} flexGrow={1}>
            <Show when={listed.loading}>
              <text fg={theme.text.muted}>Listing the folder on the hand…</text>
            </Show>
            <For each={entries()}>
              {(entry, at) => (
                <text
                  id={`ren-file-${at()}`}
                  fg={at() === index() || entry.type === "directory" ? theme.text.base : theme.text.muted}
                  attributes={at() === index() ? TextAttributes.BOLD : 0}
                  wrapMode="none"
                >
                  {at() === index() ? "▸ " : "  "}
                  {folder() && at() === 0 ? "../" : entry.path.slice(RenPanels.parent(entry.path).length)}
                </text>
              )}
            </For>
          </scrollbox>
        }
      >
        <Show when={file.loading}>
          <text fg={theme.text.muted}>Reading the file on the hand…</text>
        </Show>
        <Show when={file()} keyed>
          {(value) => {
            if (value.type === "failed") return <text fg={theme.text.feedback.error.base}>{value.message}</text>
            return (
              <scrollbox ref={setBox} flexGrow={1}>
                <Show when={value.value.truncated}>
                  <text fg={theme.text.feedback.warning.base}>
                    Only the start of this {value.value.size}-byte file is shown.
                  </text>
                </Show>
                <Show
                  when={!value.value.binary}
                  fallback={<text fg={theme.text.muted}>A binary file of {value.value.size} bytes.</text>}
                >
                  <code
                    content={value.value.content}
                    {...(RenPanels.filetype(value.value.path) && { filetype: RenPanels.filetype(value.value.path) })}
                    syntaxStyle={props.syntax}
                    conceal={false}
                    fg={theme.text.base}
                    width="100%"
                  />
                </Show>
              </scrollbox>
            )
          }}
        </Show>
      </Show>
    </box>
  )
}
