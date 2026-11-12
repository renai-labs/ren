import { useDeferredValue, useRef, useState } from "react"
import { TimelineRow, TimelineSearch } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import type { FindBarProps } from "@ren/ui/find-bar"
import { Keyboard } from "../../platform/keyboard.js"

interface Find {
  readonly value: string
  readonly active: number
  readonly focus: number
}

const rowOf = (rows: ReadonlyArray<TimelineRow.Row>, match: TimelineSearch.Match | undefined) => {
  if (!match) return
  const row = rows.find((each) =>
    match.role === "user"
      ? each._tag === "UserMessage" && each.userMessageID === match.messageID
      : each._tag === "AssistantPart" && each.group.type === "part" && each.group.ref.partID === match.partID,
  )
  return row && TimelineRow.key(row)
}

export function useFind(input: {
  messages: ReadonlyArray<SessionMessage.Info>
  rows: ReadonlyArray<TimelineRow.Row>
  more: boolean
  loadingHistory: boolean
  onSearchEarlier: () => void
}) {
  const [find, setFind] = useState<Find>()
  const opener = useRef<HTMLElement | null>(null)
  const query = useDeferredValue(find?.value ?? "")
  const matches = TimelineSearch.matches(input.messages, query)
  const active = TimelineSearch.step(find?.active ?? 0, matches.length, 0)
  const match = find ? matches[active] : undefined
  const row = rowOf(input.rows, match)

  const open = () => {
    if (!find && document.activeElement instanceof HTMLElement) opener.current = document.activeElement
    setFind((previous) => ({ value: "", active: 0, ...previous, focus: (previous?.focus ?? 0) + 1 }))
  }

  Keyboard.useKeyDown((event) => {
    if (event.key.toLowerCase() !== "f" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
    event.preventDefault()
    open()
  })

  if (!find) return
  const props: FindBarProps = {
    value: find.value,
    onValueChange: (value) => setFind({ ...find, value, active: 0 }),
    count: matches.length,
    active,
    match: row && match ? { row, occurrence: match.occurrence } : undefined,
    focus: find.focus,
    more: input.more,
    loadingHistory: input.loadingHistory,
    onStep: (delta) => setFind({ ...find, active: TimelineSearch.step(active, matches.length, delta) }),
    onSearchEarlier: input.onSearchEarlier,
    onClose: () => {
      setFind(undefined)
      opener.current?.focus()
    },
  }
  return props
}
