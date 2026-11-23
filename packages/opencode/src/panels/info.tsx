import type { Plugin } from "@opencode/plugin/tui"
import { For, Show } from "solid-js"
import { RenCommands } from "../commands.js"
import type { RenRpc } from "../rpc.js"

function Link(props: { readonly context: Plugin.Context; readonly row: RenCommands.LinkRow; readonly first: boolean }) {
  const theme = props.context.theme
  return (
    <>
      <Show when={props.first}>
        <text fg={theme.text.base}>{props.row.group}</text>
      </Show>
      <box flexDirection="row" gap={1} minWidth={0}>
        <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
          <a href={props.row.url}>{props.row.title}</a>
        </text>
        <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
          {props.row.detail}
        </text>
      </box>
    </>
  )
}

export function Info(props: { readonly context: Plugin.Context; readonly info: RenRpc.Details | undefined }) {
  const theme = props.context.theme
  const about = () => (props.info ? RenCommands.about(props.info) : undefined)
  const rows = () => (props.info ? RenCommands.linkRows(props.info) : [])
  return (
    <Show when={props.info?.ren && props.info}>
      {(info) => (
        <box>
          <text fg={theme.text.base}>
            <b>Ren</b>
            <span style={{ fg: theme.text.muted }}> {info().space?.name}</span>
          </text>
          <Show when={info().created} fallback={<text fg={theme.text.muted}>Starts on Ren with its first prompt</text>}>
            <Show when={about()?.started}>
              <text fg={theme.text.muted}>Started {about()?.started}</text>
            </Show>
            <Show when={about()?.context}>
              <text fg={theme.text.muted}>{about()?.context}</text>
            </Show>
            <Show when={about()?.cost}>
              <text fg={theme.text.muted}>{about()?.cost} spent</text>
            </Show>
            <For each={rows()}>
              {(row, index) => (
                <Link context={props.context} row={row} first={rows()[index() - 1]?.group !== row.group} />
              )}
            </For>
            <Show when={rows().length > 0}>
              <text fg={theme.text.muted}>/ren:links to open one</text>
            </Show>
          </Show>
        </box>
      )}
    </Show>
  )
}
