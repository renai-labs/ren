export * as Browser from "./browser.js"

import { useEffect, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ChatSession } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { Option, Schema } from "effect"

export const Info = Schema.Struct({
  id: Schema.String,
  liveView: Schema.String,
  closed: Schema.Boolean,
  url: Schema.String,
  title: Schema.String,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
})
export type Info = typeof Info.Type

export type Navigate = { readonly url: string } | { readonly history: "back" | "forward" | "reload" }

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.NullOr(Info)))

const service = `${(import.meta.env.VITE_REN_INTEGRATIONS_URL ?? "https://mcp.useren.ai").replace(/\/+$/u, "")}/browser`

const sessionId = /"session_id"\s*:\s*"([a-z0-9]{8,64})"/gu

// oxlint-disable-next-line ren/no-comments -- The Kernel browser ids that the chat's tool calls name, in their input or result. A browser of a person's own Kernel account shows only in a chat that names it.
export const idsOf = (messages: ReadonlyArray<SessionMessage.Info>) => [
  ...new Set(
    messages.flatMap((message) =>
      message.type === "assistant"
        ? message.content.flatMap((part) =>
            part.type === "tool" && part.state.status === "completed"
              ? [
                  JSON.stringify(part.state.input),
                  JSON.stringify(part.state.metadata ?? {}),
                  ...part.state.content.flatMap((content) => (content.type === "text" ? [content.text] : [])),
                ].flatMap((text) => [...text.matchAll(sessionId)].map((match) => match[1] ?? ""))
              : [],
          )
        : [],
    ),
  ),
]

const keys = {
  latest: (root: Session.ID, input: { ids: ReadonlyArray<string>; running: boolean }) =>
    ["browser", root, input.ids, input.running] as const,
}

const tokenOf = (opened: ChatSession.ChatSession) => opened.accessToken

const post = async (token: () => Promise<string>, path: string, body: object, signal?: AbortSignal) =>
  globalThis.fetch(`${service}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    ...(signal && { signal }),
  })

// oxlint-disable-next-line ren/no-comments -- One read when the chat connects, names a new browser, or starts or ends a turn. Only a connected chat asks, so a read never wakes a parked brain.
export function useLatest(
  root: Session.ID,
  input: { ids: ReadonlyArray<string>; running: boolean; connected: boolean },
) {
  const token = ChatReact.useAction(root, tokenOf)
  return useQuery({
    queryKey: keys.latest(root, { ids: input.ids, running: input.running }),
    enabled: input.connected,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const response = await post(token, "/", { ids: input.ids }, signal)
      if (!response.ok) throw new Error("Ren couldn’t read the browser.")
      return Option.getOrNull(decode(await response.text()))
    },
  }).data
}

// oxlint-disable-next-line ren/no-comments -- Reads the `data:` lines of a server-sent event stream as they arrive.
const events = async (body: ReadableStream<Uint8Array>, receive: (data: string) => void) => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const read = async (buffer: string): Promise<void> => {
    const chunk = await reader.read()
    if (chunk.done) return
    const lines = (buffer + decoder.decode(chunk.value, { stream: true })).split("\n")
    const rest = lines.pop() ?? ""
    for (const line of lines) if (line.startsWith("data:")) receive(line.slice(5).trim())
    return read(rest)
  }
  return read("")
}

// oxlint-disable-next-line ren/no-comments -- Follows the browser while the Browser tab shows it. The service keeps a CDP connection only while someone watches, because it keeps the browser running and billed.
export function useWatch(root: Session.ID, input: { ids: ReadonlyArray<string>; connected: boolean }) {
  const token = ChatReact.useAction(root, tokenOf)
  const [state, setState] = useState<{ root: Session.ID; info: Info | null; failed: boolean }>()
  const ids = input.ids.join()
  useEffect(() => {
    if (!input.connected) return
    const controller = new AbortController()
    const follow = async (): Promise<void> => {
      const response = await post(token, "/watch", { ids: ids ? ids.split(",") : [] }, controller.signal).catch(
        () => undefined,
      )
      const followed =
        response?.ok && response.body
          ? await events(response.body, (data) =>
              Option.map(decode(data), (info) => setState({ root, info, failed: false })),
            ).then(
              () => true,
              () => false,
            )
          : false
      if (controller.signal.aborted) return
      if (!followed) setState((current) => current && { ...current, failed: true })
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      return follow()
    }
    void follow()
    return () => controller.abort()
  }, [root, ids, input.connected, token])
  const current = state?.root === root ? state : undefined
  return {
    info: current?.info,
    failed: current?.failed === true,
    navigate: async (to: Navigate) => {
      const response = await post(token, "/navigate", { ids: input.ids, to })
      if (!response.ok) throw new Error("The browser couldn’t open that page.")
    },
  }
}
