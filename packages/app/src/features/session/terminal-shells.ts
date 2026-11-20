import { Schema } from "effect"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { Platform } from "../../platform/platform.js"
import { Preference } from "../../lib/preference.js"

const Entry = Schema.Struct({ shells: Schema.Array(Schema.String), commands: Schema.Array(Schema.String) })

// oxlint-disable-next-line ren/no-comments -- The commands a person ran in each chat's Terminal tab. Each entry holds the shell IDs those commands got and the commands still starting. The chat, its Activity and its running work leave them out. This device keeps the list, so a reload leaves them out too. It keeps the last 200 shells of the last 50 chats.
const saved = Preference.make("terminal.shells.v1", Schema.Record(Schema.String, Entry), {})

const kept = 200

const chats = 50

const empty = { shells: [], commands: [] }

export function useTerminalShells(root: Session.ID) {
  const entry = Preference.usePreference(saved)[root] ?? empty
  const shells = new Set(entry.shells)
  const commands = new Set(entry.commands)
  return {
    has: (shell: { readonly id?: string | undefined; readonly command?: string | undefined }) =>
      (shell.id !== undefined && shells.has(shell.id)) || (shell.command !== undefined && commands.has(shell.command)),
    message: (message: SessionMessage.Info) => {
      if (message.type === "shell") return shells.has(message.shellID) || commands.has(message.command)
      // oxlint-disable-next-line ren/no-comments -- A Terminal command that fails or stops also comes back as a notice, which the chat leaves out too.
      const metadata =
        message.type === "synthetic" && message.metadata?.source === "shell" ? message.metadata : undefined
      if (!metadata || message.type !== "synthetic") return false
      return (
        (metadata.shellID !== undefined && shells.has(metadata.shellID)) ||
        (message.description !== undefined && commands.has(message.description))
      )
    },
  }
}

// oxlint-disable-next-line ren/no-comments -- The Terminal tab marks a command before it starts. So its shell never shows in the chat, even before the start returns the shell's ID.
export function useMarkTerminalShell(root: Session.ID) {
  const storage = Platform.usePlatform().storage
  const update = (change: (entry: typeof Entry.Type) => typeof Entry.Type) => {
    const all = saved.read(storage)
    const others = Object.entries(all).filter((entry) => entry[0] !== root)
    saved.write(storage, Object.fromEntries([...others.slice(1 - chats), [root, change(all[root] ?? empty)]]))
  }
  return {
    starting: (command: string) =>
      update((entry) => ({ ...entry, commands: [...entry.commands.filter((each) => each !== command), command] })),
    started: (command: string, shellID: string | undefined) =>
      update((entry) => ({
        shells: shellID ? [...entry.shells, shellID].slice(-kept) : entry.shells,
        commands: entry.commands.filter((each) => each !== command),
      })),
  }
}
