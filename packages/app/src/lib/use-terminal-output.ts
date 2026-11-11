import { useEffect, useRef, useState } from "react"
import type { WTerm } from "@wterm/react"

const rowHeight = 20

const maxRows = 24

const hideCursor = "\u001B[?25l"

const reset = "\u001Bc"

// oxlint-disable-next-line no-control-regex -- matches terminal escape sequences
const escapes = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007]*\u0007/gu

// oxlint-disable-next-line ren/no-comments -- A piped command writes bare newlines; a terminal needs a carriage return to start each line at column 0. The last newline waits for more output, so the hidden cursor does not take a row of its own.
const toTerminal = (output: string) => output.replaceAll(/\r?\n/gu, "\r\n").replace(/\r\n$/u, "")

// oxlint-disable-next-line ren/no-comments -- The rows the output takes at this width: a long line wraps, and a carriage return redraws its line.
const rowsOf = (text: string, cols: number) =>
  text
    .split("\r\n")
    .reduce(
      (rows, line) =>
        rows + Math.max(1, Math.ceil((line.split("\r").at(-1) ?? "").replaceAll(escapes, "").length / cols)),
      0,
    )

const sizeTo = (terminal: WTerm, rows: number) => {
  terminal.element.style.height = `${rows * rowHeight}px`
  if (rows !== terminal.rows) terminal.resize(terminal.cols, rows)
}

// oxlint-disable-next-line ren/no-comments -- Writes one command's output into a read-only terminal: new output is appended, and output whose start changed (only the last 64 KB is kept) is written again. The terminal grows with its output up to 24 rows, then scrolls.
export function useTerminalOutput(output: string) {
  const [terminal, setTerminal] = useState<WTerm>()
  const written = useRef<string | undefined>(undefined)
  const focused = useRef(document.activeElement)
  const text = toTerminal(output)
  useEffect(() => {
    if (!terminal || text === written.current) return
    const rows = Math.max(terminal.rows, Math.min(maxRows, rowsOf(text, terminal.cols)))
    sizeTo(terminal, rows)
    const previous = written.current
    terminal.write(
      previous !== undefined && text.startsWith(previous)
        ? text.slice(previous.length)
        : `${reset}${hideCursor}${text}`,
    )
    written.current = text
  }, [terminal, text])
  return (started: WTerm) => {
    // oxlint-disable-next-line ren/no-comments -- A terminal takes focus when it starts; give it back to where the person was typing.
    const typing = focused.current
    if (started.element.contains(document.activeElement)) {
      if (typing instanceof HTMLElement && typing !== document.body) typing.focus({ preventScroll: true })
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    sizeTo(started, 1)
    setTerminal(started)
  }
}
