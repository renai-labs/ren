import { useState } from "react"
import { TimelineText } from "@ren/chat"
import { Terminal } from "@wterm/react"
import { useTerminalOutput } from "../../lib/use-terminal-output.js"

export function TerminalOutput(props: { output: string; label: string }) {
  const onReady = useTerminalOutput(props.output)
  const [failed, setFailed] = useState(false)
  if (failed) return <div className="wrap-break-word whitespace-pre-wrap">{TimelineText.shellOutput(props.output)}</div>
  return (
    <div data-slot="terminal-output">
      <Terminal
        aria-label={props.label}
        tabIndex={-1}
        rows={1}
        autoResize
        cursorBlink={false}
        onData={() => undefined}
        onError={() => setFailed(true)}
        onReady={onReady}
      />
    </div>
  )
}
