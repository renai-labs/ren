export * as ShellTerminal from "./shell-terminal.js"

import { useEffect } from "react"
import { TimelineText } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { Shell } from "@ren/schema/shell"
import { AsyncResult } from "effect/reactivity"

const prompt = "\u001B[32m$\u001B[0m "

const dim = (text: string) => `\u001B[2m${text}\u001B[0m`

const red = (text: string) => `\u001B[31m${text}\u001B[0m`

const clearLine = "\r\u001B[K"

const transcriptLimit = 256 * 1024

const kept = 20

const lines = (text: string) => text.replaceAll(/\r?\n/gu, "\r\n")

const wide =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|\p{Extended_Pictographic}/u

// oxlint-disable-next-line ren/no-comments -- Characters as a person sees them: an emoji sequence, or a letter with its combining marks.
const grapheme = /(?:\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*|\P{M})\p{M}*|\p{M}+/gu

const characters = (text: string): ReadonlyArray<string> => text.match(grapheme) ?? []

const cells = (character: string) => (wide.test(character) ? 2 : 1)

const width = (characters: ReadonlyArray<string>) =>
  characters.reduce((total, character) => total + cells(character), 0)

// oxlint-disable-next-line no-control-regex -- drops control characters from typed or pasted text
const controls = /[\u0000-\u001F\u007F]/gu

// oxlint-disable-next-line ren/no-comments -- What arrived since the last read. ShellOutput keeps only the last 64 KB, so when its start moved, the new part begins after the end of what was already written.
const unread = (written: string, output: string) => {
  if (output.startsWith(written)) return output.slice(written.length)
  const tail = written.slice(-256)
  const at = tail ? output.lastIndexOf(tail) : -1
  return at === -1 ? output : output.slice(at + tail.length)
}

export interface Options {
  readonly run: (command: string) => Promise<Shell.Info>
  readonly interrupt: (shell: Shell.Info) => void
}

interface Busy {
  readonly command: string
  shell?: Shell.Info
}

// oxlint-disable-next-line ren/no-comments -- One terminal for a chat's workspace: a line editor at a `$` prompt runs each command through Ren, and every command's output, the person's and Ren's, streams into it. A command reads no input: Ctrl-C stops it. It outlives the tab, so the tab shows its transcript again when it opens.
const make = () => {
  let options: Options | undefined
  let write: ((data: string) => void) | undefined
  let transcript = ""
  let line: ReadonlyArray<string> = []
  let cursor = 0
  let history: ReadonlyArray<string> = []
  let browsing: number | undefined
  let draft: ReadonlyArray<string> = []
  let busy: Busy | undefined
  let prompted = false
  let atLineStart = true
  const written = new Map<Shell.ID, string>()
  const followed = new Map<Shell.ID, Shell.Info>()

  const out = (data: string) => {
    if (!data) return
    transcript = (transcript + data).slice(-transcriptLimit)
    write?.(data)
    atLineStart = data.endsWith("\n") || data.endsWith(clearLine)
  }

  const showLine = () => {
    const after = width(line.slice(cursor))
    out(`${clearLine}${prompt}${line.join("")}${after ? `\u001B[${after}D` : ""}`)
    prompted = true
  }

  // oxlint-disable-next-line ren/no-comments -- Output that arrives while the prompt shows goes above it, and the prompt follows with what the person was typing.
  const above = (data: string) => {
    if (!data) return
    if (prompted) out(clearLine)
    prompted = false
    out(data)
    if (busy) return
    if (!atLineStart) out("\r\n")
    showLine()
  }

  const ready = () => {
    busy = undefined
    if (!atLineStart) out("\r\n")
    showLine()
  }

  const edit = (next: ReadonlyArray<string>, at: number) => {
    line = next
    cursor = at
    showLine()
  }

  const recall = (index: number | undefined) => {
    if (browsing === undefined) draft = line
    browsing = index
    const next = index === undefined ? draft : characters(history[index] ?? "")
    edit(next, next.length)
  }

  const submit = () => {
    const command = line.join("").trim()
    line = []
    cursor = 0
    browsing = undefined
    out("\r\n")
    prompted = false
    if (!command || !options) return showLine()
    if (history.at(-1) !== command) history = [...history, command]
    const started: Busy = { command }
    busy = started
    options.run(command).then(
      (shell) => {
        if (busy !== started) return
        started.shell = shell
        followed.set(shell.id, shell)
      },
      (error: unknown) => {
        if (busy !== started) return
        out(`${red(error instanceof Error ? error.message : String(error))}\r\n`)
        ready()
      },
    )
  }

  const interrupt = () => {
    if (busy?.shell) return options?.interrupt(busy.shell)
    if (busy) return
    out("^C\r\n")
    edit([], 0)
  }

  const erasePrevious = () => {
    if (cursor > 0) edit([...line.slice(0, cursor - 1), ...line.slice(cursor)], cursor - 1)
  }

  const eraseNext = () => {
    if (cursor < line.length) edit([...line.slice(0, cursor), ...line.slice(cursor + 1)], cursor)
  }

  const eraseWord = () => {
    const before = characters(
      line
        .slice(0, cursor)
        .join("")
        .replace(/\S+\s*$/u, ""),
    )
    edit([...before, ...line.slice(cursor)], before.length)
  }

  const keys: Readonly<Record<string, () => void>> = {
    "\r": submit,
    "\u000C": () => {
      out("\u001B[2J\u001B[3J\u001B[H")
      showLine()
    },
    "\u0015": () => edit(line.slice(cursor), 0),
    "\u000B": () => edit(line.slice(0, cursor), cursor),
    "\u0017": eraseWord,
    "\u007F": erasePrevious,
    "\b": erasePrevious,
    "\u001B[3~": eraseNext,
    "\u001B[D": () => edit(line, Math.max(0, cursor - 1)),
    "\u001B[C": () => edit(line, Math.min(line.length, cursor + 1)),
    "\u0001": () => edit(line, 0),
    "\u001B[H": () => edit(line, 0),
    "\u001BOH": () => edit(line, 0),
    "\u0005": () => edit(line, line.length),
    "\u001B[F": () => edit(line, line.length),
    "\u001BOF": () => edit(line, line.length),
    "\u001B[A": () => {
      if (history.length > 0) recall(Math.max(0, (browsing ?? history.length) - 1))
    },
    "\u001B[B": () => {
      if (browsing !== undefined) recall(browsing + 1 < history.length ? browsing + 1 : undefined)
    },
  }

  const key = (data: string) => {
    if (data === "\u0003") return interrupt()
    if (busy) return
    const action = keys[data]
    if (action) return action()
    if (data.startsWith("\u001B")) return
    const typed = characters(data.replaceAll(controls, ""))
    if (typed.length > 0) edit([...line.slice(0, cursor), ...typed, ...line.slice(cursor)], cursor + typed.length)
  }

  return {
    configure: (next: Options) => {
      options = next
    },
    // oxlint-disable-next-line ren/no-comments -- A new terminal for the tab: it shows the transcript so far. Writes to the terminal of a closed tab are dropped.
    attach: (writer: (data: string) => void) => {
      write = writer
      if (transcript) return writer(transcript)
      out(`${dim("Commands run in this chat's workspace. Ren's commands show here too.")}\r\n`)
      showLine()
    },
    // oxlint-disable-next-line ren/no-comments -- A key, or pasted text: each pasted newline runs the line before it, and what follows while a command runs is dropped.
    input: (data: string) => {
      if (data.length === 1 || data.startsWith("\u001B")) return key(data)
      const parts = data.split(/\r\n?|\n/u)
      for (const [index, part] of parts.entries()) {
        if (part) key(part)
        if (index < parts.length - 1) key("\r")
      }
    },
    // oxlint-disable-next-line ren/no-comments -- The commands this terminal still follows, for a tab that opens again.
    following: () => [...followed.values()].map((shell) => ({ shell, mine: busy?.shell?.id === shell.id })),
    started: (shell: Shell.Info) => {
      if (followed.has(shell.id) || written.has(shell.id)) return
      if (busy && !busy.shell && busy.command === shell.command.trim()) return
      followed.set(shell.id, shell)
      above(`${dim("ren $")} ${shell.command}\r\n`)
    },
    output: (shell: Shell.Info, output: string) => {
      if (!followed.has(shell.id)) return
      const text = lines(output)
      const fresh = unread(written.get(shell.id) ?? "", text)
      written.set(shell.id, text)
      if (busy?.shell?.id === shell.id) out(fresh)
      else above(fresh)
    },
    finished: (shell: Shell.Info, error: string | undefined) => {
      if (!followed.delete(shell.id)) return
      const end = error ? `${red(error)}\r\n` : ""
      if (busy?.shell?.id !== shell.id) return above(end)
      if (!atLineStart) out("\r\n")
      out(end)
      ready()
    },
  }
}

export type ShellTerminal = ReturnType<typeof make>

const terminals = new Map<Session.ID, ShellTerminal>()

export const of = (root: Session.ID) => {
  const found = terminals.get(root) ?? make()
  terminals.delete(root)
  terminals.set(root, found)
  const oldest = terminals.keys().next().value
  if (terminals.size > kept && oldest) terminals.delete(oldest)
  return found
}

export function useOptions(terminal: ShellTerminal, options: Options) {
  useEffect(() => terminal.configure(options))
}

// oxlint-disable-next-line ren/no-comments -- Streams one command's output into the terminal, then its end once the last read is in.
export function useFollow(terminal: ShellTerminal, root: Session.ID, shell: Shell.Info) {
  const view = { root, sessionID: shell.sessionID, shellID: shell.id }
  const info = ChatReact.useShell(view)
  const current = AsyncResult.getOrElse(info, () => shell)
  const live = ChatReact.useShellRunning(root, shell.id)
  const running = !AsyncResult.isFailure(info) && (live || current.status === "running")
  const result = ChatReact.useShellOutput({ ...view, running })
  const output = AsyncResult.getOrElse(result, () => "")
  const end = AsyncResult.isFailure(info) ? "Cancelled" : TimelineText.shellError(current)
  const settled = !running && !AsyncResult.isWaiting(result)
  useEffect(() => {
    terminal.started(shell)
    terminal.output(shell, output)
    if (settled) terminal.finished(shell, end)
  }, [terminal, shell, output, settled, end])
}
