import { useDeferredValue, useState } from "react"
import { ClientCommand, Composer, Mentions } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { SessionCatalog } from "@ren/schema/session/catalog"
import { AsyncResult } from "effect/reactivity"

interface SuggestionItem {
  readonly value: string
  readonly kind: "command" | Mentions.Kind
  readonly label: string
  readonly description?: string | undefined
}

export interface Suggest {
  readonly open: boolean
  readonly label: string
  readonly items: ReadonlyArray<SuggestionItem>
  readonly active: string | undefined
  readonly onCursor: (text: string, cursor: number) => void
  readonly onKey: (press: Composer.SuggestionPress) => boolean
  readonly onChoose: (value: string, text: string, cursor: number) => { text: string; cursor: number } | undefined
  readonly onClose: () => void
}

const listed = <A>(result: AsyncResult.AsyncResult<ReadonlyArray<A>, unknown>) =>
  AsyncResult.isSuccess(result) ? result.value : []

export function useComposerSuggestions(input: {
  root: Session.ID
  commands: boolean
  client: Readonly<Record<ClientCommand.ID, boolean>>
  onClient: (id: ClientCommand.ID) => void
}) {
  const [trigger, setTrigger] = useState<Composer.Trigger>()
  const [active, setActive] = useState<string>()
  const [picked, setPicked] = useState<ReadonlyArray<Mentions.Item>>([])
  const query = trigger?.kind === "mention" ? trigger.query : undefined
  const searched = useDeferredValue(query ?? "")
  const found = listed(ChatReact.useFiles({ root: input.root, query: searched, type: "file" }))
  const agents = SessionCatalog.mentionable(listed(ChatReact.useAgents(input.root))).map(Mentions.fromAgent)
  const skills = Composer.offeredSkills(listed(ChatReact.useSkills(input.root))).map(Mentions.fromSkill)
  const files = searched && query ? found.map(Mentions.fromFile) : []
  const offered = Composer.offeredCommands(listed(ChatReact.useCommands(input.root)))
  const brain = input.commands ? offered : []
  const runnable = ClientCommand.suggestions(
    ClientCommand.offered(input.client),
    brain,
    trigger?.kind === "command" ? trigger.query : "",
  )
  const mentionable = query === undefined ? [] : Mentions.suggest({ agents, skills, files, query })
  const items: ReadonlyArray<SuggestionItem> =
    trigger?.kind === "command"
      ? runnable.map((item) => ({
          value: item.value,
          kind: "command",
          label: `/${item.trigger}`,
          description: item.description,
        }))
      : mentionable.map((item) => ({
          value: Mentions.key(item),
          kind: item.kind,
          label: item.label,
          description: item.description,
        }))
  const ids = items.map((item) => item.value)
  const current = Composer.activeSuggestion(ids, active)
  const catalog = [...agents, ...skills, ...picked]
  const close = () => {
    setTrigger(undefined)
    setActive(undefined)
  }
  const suggest: Suggest = {
    open: trigger !== undefined && items.length > 0,
    label: trigger?.kind === "command" ? "Commands" : "Mentions",
    items,
    active: current,
    onCursor: (text, cursor) => {
      setTrigger(Composer.trigger(text, cursor))
      setActive(undefined)
    },
    onKey: (press) => {
      if (trigger === undefined || ids.length === 0) return false
      const key = Composer.suggestionKey(press, ids, current)
      if (key?.type === "close") close()
      if (key?.type === "move") setActive(key.active)
      return key !== undefined && key.type !== "select"
    },
    onChoose: (value, text, cursor) => {
      close()
      if (trigger?.kind === "command") {
        const command = runnable.find((item) => item.value === value)
        if (command?.client) {
          input.onClient(command.client)
          return { text: "", cursor: 0 }
        }
        const next = `/${command?.trigger ?? value} `
        return { text: next, cursor: next.length }
      }
      const item = mentionable.find((entry) => Mentions.key(entry) === value)
      if (!item || trigger?.kind !== "mention") return
      if (item.kind === "file") setPicked([...picked, item])
      return Mentions.insert(text, item, trigger.start, cursor)
    },
    onClose: close,
  }
  return {
    suggest,
    slash: (text: string) => Composer.slash(text, brain),
    resolve: (text: string) => Mentions.resolve(text, Mentions.tokens(text, catalog)),
  }
}
