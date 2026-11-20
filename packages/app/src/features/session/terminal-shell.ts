export * as TerminalShell from "./terminal-shell.js"

import type { Shell } from "@ren/schema/shell"

export interface Io {
  readonly write: (data: string) => void
  readonly start: (command: string) => Promise<Shell.Info>
  readonly exited: (shellID: Shell.ID) => { readonly done: Promise<void>; readonly cancel: () => void }
  readonly output: (shellID: Shell.ID, cursor: number) => Promise<Shell.Output>
  readonly stop: (shellID: Shell.ID) => Promise<unknown>
  readonly started: (command: string, shellID: Shell.ID | undefined) => void
}

const marker = "\u001eREN_CWD:"

const end = "\u001e"

const field = "\u001f"

const poll = 250

const reset = "\u001b[0m"

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const dim = (text: string) => `\u001b[2m${text}${reset}`

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const crlf = (text: string) => text.replaceAll(/\r?\n/gu, "\r\n")

// oxlint-disable-next-line ren/no-comments -- The shell's starting folder reads as home, ~. Until the first command reports that folder, the prompt shows full paths.
const shown = (cwd: string | undefined, home: string | undefined) => {
  if (!cwd) return "~"
  if (!home || (cwd !== home && !cwd.startsWith(`${home}/`))) return cwd
  return `~${cwd.slice(home.length)}`
}

const report = (status: string) =>
  `printf '\\n${marker.replace("\u001e", "\\036")}%s\\037%s\\037%s\\036' "${status}" "$__ren_home" "$PWD"`

// oxlint-disable-next-line ren/no-comments -- Each command starts in the folder where the last one ended. It ends with a marker that the tab hides, which holds its exit status, the shell's starting folder and the folder where it ended. So `cd` works as in a real shell, and the tab knows the command is over without asking Ren. When the folder is gone, the command does not run.
const wrapped = (command: string, cwd: string | undefined) =>
  [
    "__ren_home=$PWD",
    cwd ? `cd ${quote(cwd)} || { ${report("1")}; exit 1; }` : "",
    command,
    "__ren_status=$?",
    report("$__ren_status"),
    "exit $__ren_status",
  ]
    .filter(Boolean)
    .join("\n")

// oxlint-disable-next-line ren/no-comments -- The line discipline behind the Terminal tab. Ren has no terminal on the computer, only a call that runs one command. So the tab keeps the line, the history and the working folder here, runs each command whole through Ren and streams its output as it arrives.
export function make(input: { readonly folder: string | undefined; readonly io: () => Io }) {
  const state = {
    line: "",
    cursor: 0,
    history: [] as Array<string>,
    browsing: -1,
    draft: "",
    cwd: input.folder,
    home: undefined as string | undefined,
    failed: false,
    closed: false,
    running: undefined as Shell.ID | undefined,
    busy: false,
    stopping: false,
    ahead: "",
  }

  const prompt = () =>
    `\u001b[1;32mren${reset}:\u001b[1;34m${shown(state.cwd, state.home)}${reset}${state.failed ? "\u001b[1;31m" : ""}$${reset} `

  const redraw = () => {
    const io = input.io()
    io.write(`\r\u001b[K${prompt()}${state.line}`)
    const back = state.line.length - state.cursor
    if (back > 0) io.write(`\u001b[${back}D`)
  }

  const set = (line: string, cursor = line.length) => {
    state.line = line
    state.cursor = cursor
    redraw()
  }

  // oxlint-disable-next-line ren/no-comments -- While a command starts and runs, the tab shows a dim spinner and the elapsed time on the line where output goes next, so a slow start never looks frozen. Output clears the spinner first, and the spinner waits while output is mid-line.
  const live = {
    timer: undefined as ReturnType<typeof setInterval> | undefined,
    shown: false,
    frame: 0,
    since: 0,
    read: undefined as { held: string; last: string } | undefined,
  }

  const hide = () => {
    if (!live.shown) return
    input.io().write("\r\u001b[K")
    live.shown = false
  }

  const phase = () => {
    if (state.stopping) return "Stopping"
    return state.running ? "Running" : "Starting"
  }

  const tick = () => {
    const read = live.read
    if (read && read.held === "\n") {
      input.io().write("\r\n")
      read.held = ""
      read.last = "\n"
    }
    if (read && (read.held !== "" || read.last !== "\n")) return
    const seconds = Math.floor((Date.now() - live.since) / 1000)
    const frame = frames[live.frame % frames.length]
    live.frame += 1
    input.io().write(`\r\u001b[K${dim(`${frame} ${phase()} ${seconds}s · Ctrl+C to stop`)}`)
    live.shown = true
  }

  const spin = () => {
    live.since = Date.now()
    live.read = undefined
    input.io().write("\u001b[?25l")
    tick()
    live.timer = setInterval(tick, 100)
  }

  const settle = () => {
    clearInterval(live.timer)
    live.timer = undefined
    live.read = undefined
    hide()
    input.io().write("\u001b[?25h")
  }

  // oxlint-disable-next-line ren/no-comments -- Output is written as it arrives, except text that may still be the closing marker. That is a trailing line end, which starts the marker line, and anything from the marker's first byte until the marker is whole. The command is over when the marker arrives. A command that is stopped, killed or exits early never prints it, so its exit event ends it instead, after a last read. Closing the tab ends the read.
  const stream = async (shellID: Shell.ID) => {
    const io = input.io()
    const read = { cursor: 0, held: "", last: "\n", status: undefined as number | undefined, failures: 0 }
    live.read = read
    const exit = io.exited(shellID)
    const gone = { value: false }
    void exit.done.then(() => {
      gone.value = true
    })
    const show = (text: string) => {
      if (!text) return
      hide()
      io.write(crlf(text))
      read.last = text.at(-1) ?? read.last
    }
    const flush = (text: string): string => {
      const at = text.indexOf(end)
      const visible = at < 0 ? text : text.slice(0, at)
      const rest = at < 0 ? "" : text.slice(at)
      const trailing = visible.endsWith("\n") ? "\n" : ""
      show(trailing ? visible.slice(0, -1) : visible)
      if (!rest) return trailing
      if (!marker.startsWith(rest.slice(0, marker.length)) && !rest.startsWith(marker)) {
        show(trailing + rest.slice(0, 1))
        return flush(rest.slice(1))
      }
      const closing = rest.indexOf(end, 1)
      if (!rest.startsWith(marker) || closing < 0) return trailing + rest
      const fields = rest.slice(marker.length, closing).split(field)
      read.status = Number(fields[0])
      state.home = fields[1] || state.home
      state.cwd = fields[2] || state.cwd
      return flush(rest.slice(closing + 1))
    }
    const page = async () => {
      const got = await io.output(shellID, read.cursor).catch(() => undefined)
      if (!got) {
        read.failures += 1
        return false
      }
      read.failures = 0
      const advanced = got.cursor > read.cursor
      read.cursor = Math.max(read.cursor, got.cursor)
      read.held = flush(read.held + got.output)
      return advanced && got.cursor < got.size
    }
    const follow = async (): Promise<void> => {
      if (state.closed) return
      const ended = gone.value
      const more = await page()
      if (read.status !== undefined) return
      if (more) return follow()
      if (ended || read.failures >= 4) return
      await Promise.race([wait(poll), exit.done])
      return follow()
    }
    await follow()
    exit.cancel()
    if (read.status === undefined && !read.held.includes(end)) show(read.held)
    return { status: read.status, last: read.last }
  }

  const run = async (command: string) => {
    const io = input.io()
    state.busy = true
    spin()
    const sent = wrapped(command, state.cwd)
    const started = await io.start(sent).then(
      (info) => {
        io.started(sent, info.id)
        return info
      },
      (error: unknown) => {
        io.started(sent, undefined)
        hide()
        io.write(`\u001b[31m${error instanceof Error ? error.message : "The command did not start"}${reset}\r\n`)
      },
    )
    if (started) {
      state.running = started.id
      const done = await stream(started.id)
      settle()
      state.failed = done.status !== 0
      if (!state.stopping && done.last !== "\n") io.write("\r\n")
    }
    settle()
    state.running = undefined
    state.busy = false
    state.stopping = false
    io.write(prompt())
    const ahead = state.ahead
    state.ahead = ""
    if (ahead) handle(ahead)
  }

  const submit = () => {
    const io = input.io()
    const command = state.line
    io.write("\r\n")
    state.line = ""
    state.cursor = 0
    state.browsing = -1
    const text = command.trim()
    if (!text) return io.write(prompt())
    if (state.history.at(-1) !== text) state.history.push(text)
    if (text === "clear") return io.write(`\u001b[2J\u001b[3J\u001b[H${prompt()}`)
    void run(text)
  }

  const browse = (step: -1 | 1) => {
    if (state.history.length === 0) return
    if (state.browsing < 0) {
      if (step > 0) return
      state.draft = state.line
      state.browsing = state.history.length
    }
    const next = state.browsing + step
    if (next < 0) return
    if (next >= state.history.length) {
      state.browsing = -1
      return set(state.draft)
    }
    state.browsing = next
    set(state.history[next] ?? "")
  }

  const insert = (text: string) => {
    state.line = state.line.slice(0, state.cursor) + text + state.line.slice(state.cursor)
    state.cursor += text.length
    redraw()
  }

  const word = () => {
    const before = state.line.slice(0, state.cursor).replace(/\S+\s*$/u, "")
    state.line = before + state.line.slice(state.cursor)
    state.cursor = before.length
    redraw()
  }

  const keys: Record<string, () => void> = {
    "\r": submit,
    "\u007f": () => {
      if (state.cursor === 0) return
      state.line = state.line.slice(0, state.cursor - 1) + state.line.slice(state.cursor)
      state.cursor -= 1
      redraw()
    },
    "\u001b[3~": () => {
      if (state.cursor >= state.line.length) return
      state.line = state.line.slice(0, state.cursor) + state.line.slice(state.cursor + 1)
      redraw()
    },
    "\u001b[D": () => {
      if (state.cursor === 0) return
      state.cursor -= 1
      input.io().write("\u001b[D")
    },
    "\u001b[C": () => {
      if (state.cursor >= state.line.length) return
      state.cursor += 1
      input.io().write("\u001b[C")
    },
    "\u001b[A": () => browse(-1),
    "\u001b[B": () => browse(1),
    "\u001b[H": () => set(state.line, 0),
    "\u001b[F": () => set(state.line),
    "\u0001": () => set(state.line, 0),
    "\u0005": () => set(state.line),
    "\u0015": () => set(state.line.slice(state.cursor), 0),
    "\u000b": () => set(state.line.slice(0, state.cursor)),
    "\u0017": word,
    "\u001b\u007f": word,
    "\u000c": () => {
      input.io().write("\u001b[2J\u001b[3J\u001b[H")
      redraw()
    },
    "\u0003": () => {
      input.io().write("^C\r\n")
      state.line = ""
      state.cursor = 0
      state.browsing = -1
      input.io().write(prompt())
    },
    "\t": () => undefined,
  }

  // oxlint-disable-next-line ren/no-comments -- While a command runs, keys wait and play back at the next prompt, as a shell reads type-ahead. Ctrl+C stops the command instead.
  const handle = (data: string): void => {
    const io = input.io()
    if (state.busy) {
      if (data !== "\u0003") {
        state.ahead += data
        return
      }
      state.ahead = ""
      if (!state.running || state.stopping) return
      state.stopping = true
      hide()
      io.write("^C\r\n")
      void io.stop(state.running).catch(() => undefined)
      return
    }
    const key = keys[data]
    if (key) return key()
    if (data.startsWith("\u001b")) return
    // oxlint-disable-next-line ren/no-comments -- Pasted text runs line by line, as a shell reads it. Control characters other than line ends are dropped. The lines after one that starts a command wait for the next prompt.
    const lines = data.replaceAll("\r\n", "\r").replaceAll("\n", "\r").split("\r")
    lines.some((line, index) => {
      const text = line.replaceAll(/\p{Cc}/gu, "")
      if (text) insert(text)
      if (index === lines.length - 1) return true
      submit()
      if (state.busy) state.ahead += lines.slice(index + 1).join("\r")
      return state.busy
    })
  }

  return {
    attach: () => {
      const io = input.io()
      io.write(prompt())
    },
    input: (data: string) => handle(data),
    moveTo: (folder: string) => {
      if (folder === state.cwd) return
      state.cwd = folder
      if (!state.busy) redraw()
    },
    // oxlint-disable-next-line ren/no-comments -- Returns the close, which the tab runs when it unmounts. Closing stops the spinner and the output read of a running command.
    open: () => {
      state.closed = false
      return () => {
        state.closed = true
        clearInterval(live.timer)
      }
    },
  }
}

export type TerminalShell = ReturnType<typeof make>
