import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { type ScrollBoxRenderable, type SyntaxStyle, TextAttributes } from "@opentui/core"
import { createResource, createSignal, For, Show } from "solid-js"
import { RenPanels } from "../panels.js"
import type { RenRpc } from "../rpc.js"

const modes: ReadonlyArray<RenRpc.DiffMode> = ["working", "branch", "committed"]

const labels = { working: "Uncommitted", branch: "Branch", committed: "Committed" }

const marks = { added: "A", deleted: "D", modified: "M" }

export function Changes(props: {
  readonly context: Plugin.Context
  readonly reader: Parameters<typeof RenPanels.changes>[0]
  readonly panel: PanelInput
  readonly syntax: SyntaxStyle
}) {
  const theme = props.context.theme
  const [path, setPath] = createSignal<string>()
  const [mode, setMode] = createSignal<RenRpc.DiffMode>("working")
  const [index, setIndex] = createSignal(0)
  const [loaded, { refetch }] = createResource(
    () => {
      const chosen = path()
      // ast-grep-ignore: no-nullish-comparison, -- "" is the session's folder, undefined is the first repository
      return { sessionID: props.panel.sessionID, mode: mode(), ...(chosen !== undefined && { path: chosen }) }
    },
    (input) => RenPanels.changes(props.reader, input),
  )
  const changes = () => {
    const value = loaded()
    return value?.type === "ready" ? value.value : undefined
  }
  const files = () => changes()?.files ?? []
  const selected = () => files()[Math.min(index(), files().length - 1)]
  const [box, setBox] = createSignal<ScrollBoxRenderable>()
  const [list, setList] = createSignal<ScrollBoxRenderable>()
  const move = (by: number) => {
    const next = Math.max(0, Math.min(files().length - 1, index() + by))
    setIndex(next)
    list()?.scrollChildIntoView(`ren-change-${next}`)
  }
  props.context.keymap.layer(() => ({
    commands: [
      { title: "Next file", bind: "j", run: () => move(1) },
      { title: "Next file", bind: "down", run: () => move(1) },
      { title: "Previous file", bind: "k", run: () => move(-1) },
      { title: "Previous file", bind: "up", run: () => move(-1) },
      { title: "Scroll down", bind: "pagedown", run: () => box()?.scrollBy(10) },
      { title: "Scroll up", bind: "pageup", run: () => box()?.scrollBy(-10) },
      {
        title: "Switch the comparison",
        bind: "m",
        run: () => {
          setIndex(0)
          setMode((current) => modes[(modes.indexOf(current) + 1) % modes.length] ?? "working")
        },
      },
      {
        title: "Pick a repository",
        bind: "p",
        run: () => {
          const projects = changes()?.projects ?? []
          if (projects.length < 2) return
          void props.context.ui.dialog
            .select({
              title: "Repository",
              current: changes()?.path,
              options: projects.map((project) => ({
                title: project.path || "Session folder",
                value: project.path,
                description: project.branch ?? "",
              })),
            })
            .then((chosen) => {
              // ast-grep-ignore: no-nullish-comparison, -- "" is the session's folder
              if (chosen === undefined) return
              setIndex(0)
              setPath(chosen)
            })
        },
      },
      { title: "Refresh", bind: "r", run: () => void refetch() },
      { title: "Full screen", bind: "f", run: props.panel.toggleFullscreen },
    ],
  }))
  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
        Ren changes · {labels[mode()]}
        {changes() ? ` · ${changes()?.path || "session folder"}` : ""}
        {changes()?.branch.current ? ` (${changes()?.branch.current})` : ""}
      </text>
      <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
        j/k file · m comparison · p repository · r refresh · f full screen
      </text>
      <Show when={loaded.loading}>
        <text fg={theme.text.muted}>Loading the changes on the hand…</text>
      </Show>
      <Show when={RenPanels.problem(loaded())}>
        {(message) => <text fg={theme.text.feedback.error.base}>{message()}</text>}
      </Show>
      <Show when={changes() && !changes()?.repository}>
        <text fg={theme.text.muted}>This folder on the hand is not a git repository.</text>
      </Show>
      <Show when={changes()?.repository && files().length === 0}>
        <text fg={theme.text.muted}>No changes.</text>
      </Show>
      <scrollbox ref={setList} flexShrink={0} height={Math.min(files().length, 10)}>
        <For each={files()}>
          {(file, at) => (
            <text
              id={`ren-change-${at()}`}
              fg={file === selected() ? theme.text.base : theme.text.muted}
              attributes={file === selected() ? TextAttributes.BOLD : 0}
              wrapMode="none"
            >
              {file === selected() ? "▸ " : "  "}
              {marks[file.status]} {file.file} <span style={{ fg: theme.diff.highlight.added }}>+{file.additions}</span>{" "}
              <span style={{ fg: theme.diff.highlight.removed }}>-{file.deletions}</span>
            </text>
          )}
        </For>
      </scrollbox>
      <Show when={selected()}>
        {(file) => (
          <scrollbox ref={setBox} flexGrow={1} marginTop={1}>
            <Show when={file().truncated}>
              <text fg={theme.text.feedback.warning.base}>The patch is cut: Ren shows at most 64 KiB of it.</text>
            </Show>
            <diff
              diff={file().patch}
              view="unified"
              {...(RenPanels.filetype(file().file) && { filetype: RenPanels.filetype(file().file) })}
              syntaxStyle={props.syntax}
              showLineNumbers
              width="100%"
              wrapMode="char"
              fg={theme.text.base}
              addedBg={theme.diff.background.added}
              removedBg={theme.diff.background.removed}
              contextBg={theme.diff.background.context}
              addedSignColor={theme.diff.highlight.added}
              removedSignColor={theme.diff.highlight.removed}
              lineNumberFg={theme.diff.lineNumber.text}
              lineNumberBg={theme.diff.background.context}
              addedLineNumberBg={theme.diff.lineNumber.background.added}
              removedLineNumberBg={theme.diff.lineNumber.background.removed}
            />
          </scrollbox>
        )}
      </Show>
    </box>
  )
}
