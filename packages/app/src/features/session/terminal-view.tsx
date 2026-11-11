import { Terminal } from "@wterm/react"
import type { ShellTerminal } from "../../lib/shell-terminal.js"

export function TerminalView(props: { terminal: ShellTerminal; onError: () => void }) {
  return (
    <Terminal
      className="h-full"
      aria-label="Terminal"
      autoResize
      onData={props.terminal.input}
      onError={props.onError}
      onReady={(instance) => props.terminal.attach((data) => instance.write(data))}
    />
  )
}
