import type {
  EventSubscribeOutput,
  ModelListOutput,
  SessionGetInput,
  SessionGetOutput,
  SessionMessagesInput,
  SessionMessagesOutput,
  SessionMessageInput,
  SessionMessageOutput,
  SessionChildrenInput,
  SessionChildrenOutput,
  SessionInboxListInput,
  SessionInboxListOutput,
  SessionPermissionListInput,
  SessionPermissionListOutput,
  SessionFormListInput,
  SessionFormListOutput,
  SessionPromptInput,
  SessionPromptOutput,
  SessionCompactInput,
  SessionCompactOutput,
  SessionInterruptInput,
  SessionInterruptOutput,
  SessionBackgroundInput,
  SessionBackgroundOutput,
  SessionRenameInput,
  SessionRenameOutput,
  SessionRevertStageInput,
  SessionRevertStageOutput,
  SessionRevertClearInput,
  SessionRevertClearOutput,
  SessionRevertCommitInput,
  SessionRevertCommitOutput,
  SessionInboxCancelInput,
  SessionInboxCancelOutput,
  SessionInboxUpdateInput,
  SessionInboxUpdateOutput,
  SessionCommandInput,
  SessionCommandOutput,
  SessionModelSwitchInput,
  SessionModelSwitchOutput,
  SessionPermissionReplyInput,
  SessionPermissionReplyOutput,
  SessionFormReplyInput,
  SessionFormReplyOutput,
  SessionFormCancelInput,
  SessionFormCancelOutput,
  SessionStatusOutput,
  ShellListInput,
  ShellListOutput,
  ShellOutputInput,
  ShellOutputOutput,
  ShellRemoveInput,
  ShellRemoveOutput,
  AgentListInput,
  AgentListOutput,
  SkillListInput,
  SkillListOutput,
  CommandListInput,
  CommandListOutput,
  FileSearchInput,
  FileSearchOutput,
  WebsearchProvidersInput,
  WebsearchProvidersOutput,
} from "./types.js"
import { ClientError } from "./client-error.js"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch | undefined
  readonly headers?: RequestInit["headers"]
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: RequestInit["headers"]
  /** Reports every chunk a streaming response receives, including keepalive comments that yield no event. */
  readonly onActivity?: () => void
}

interface RequestDescriptor {
  readonly method: string
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly headers?: Record<string, unknown>
  readonly body?: unknown
  readonly successStatus: number
  readonly declaredStatuses: ReadonlyArray<number>
  readonly empty: boolean
}

const maxSseEventBytes = 16 * 1024 * 1024

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    // A leading slash would replace any path prefix on baseUrl, so join relative to it.
    const baseUrl = new URL(options.baseUrl)
    if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/"
    const url = new URL(descriptor.path.slice(1), baseUrl)
    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        headers,
        ...(requestOptions?.signal !== undefined && { signal: requestOptions.signal }),
        ...(descriptor.body !== undefined && { body: JSON.stringify(descriptor.body) }),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    if (descriptor.declaredStatuses.includes(response.status))
      throw declared((await json(response)) as DeclaredErrorBody)
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status }, detail: String(response.status) })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    return (await json(response)) as A
  }

  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions)
      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel()
        } catch {}
        throw new ClientError("UnsupportedContentType", { detail: response.headers.get("content-type") })
      }
      if (response.body === null) throw new ClientError("MalformedResponse")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (true) {
          let next
          try {
            next = await reader.read()
          } catch (cause) {
            throw new ClientError("Transport", { cause })
          }
          if (!next.done) requestOptions?.onActivity?.()
          buffer += decoder.decode(next.value, { stream: !next.done })
          if (buffer.length > maxSseEventBytes) throw new ClientError("SseEventTooLarge")
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r")
          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
          buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
          if (trailingCarriageReturn) buffer += "\r"
          if (next.done && buffer !== "") buffer += "\n\n"
          let boundary = buffer.indexOf("\n\n")
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = block
              .split("\n")
              .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
              .join("\n")
            if (data !== "") {
              try {
                yield JSON.parse(data) as A
              } catch (cause) {
                throw new ClientError("MalformedResponse", { cause })
              }
            }
            boundary = buffer.indexOf("\n\n")
          }
          if (next.done) return
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        reader.releaseLock()
      }
    },
  })

  return {
    event: {
      subscribe: (requestOptions?: RequestOptions): AsyncIterable<EventSubscribeOutput> =>
        sse<EventSubscribeOutput>(
          { method: "GET", path: `/chat/event`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    model: {
      list: (requestOptions?: RequestOptions) =>
        request<ModelListOutput>(
          { method: "GET", path: `/chat/model`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    session: {
      get: (input: SessionGetInput, requestOptions?: RequestOptions) =>
        request<SessionGetOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [403, 404],
            empty: false,
          },
          requestOptions,
        ),
      messages: (input: SessionMessagesInput, requestOptions?: RequestOptions) =>
        request<SessionMessagesOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/message`,
            query: { limit: input["limit"], cursor: input["cursor"] },
            successStatus: 200,
            declaredStatuses: [400, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      message: (input: SessionMessageInput, requestOptions?: RequestOptions) =>
        request<SessionMessageOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
            successStatus: 200,
            declaredStatuses: [403, 404],
            empty: false,
          },
          requestOptions,
        ),
      children: (input: SessionChildrenInput, requestOptions?: RequestOptions) =>
        request<SessionChildrenOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/children`,
            successStatus: 200,
            declaredStatuses: [403, 404],
            empty: false,
          },
          requestOptions,
        ),
      inbox: {
        list: (input: SessionInboxListInput, requestOptions?: RequestOptions) =>
          request<SessionInboxListOutput>(
            {
              method: "GET",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/inbox`,
              successStatus: 200,
              declaredStatuses: [403, 404],
              empty: false,
            },
            requestOptions,
          ),
        cancel: (input: SessionInboxCancelInput, requestOptions?: RequestOptions) =>
          request<SessionInboxCancelOutput>(
            {
              method: "DELETE",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/inbox/${encodeURIComponent(input.inboxID)}`,
              successStatus: 204,
              declaredStatuses: [403, 404, 409],
              empty: true,
            },
            requestOptions,
          ),
        update: (input: SessionInboxUpdateInput, requestOptions?: RequestOptions) =>
          request<SessionInboxUpdateOutput>(
            {
              method: "PATCH",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/inbox/${encodeURIComponent(input.inboxID)}`,
              body: { delivery: input["delivery"] },
              successStatus: 204,
              declaredStatuses: [403, 404, 409],
              empty: true,
            },
            requestOptions,
          ),
      },
      permission: {
        list: (input: SessionPermissionListInput, requestOptions?: RequestOptions) =>
          request<SessionPermissionListOutput>(
            {
              method: "GET",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/permission`,
              successStatus: 200,
              declaredStatuses: [403, 404],
              empty: false,
            },
            requestOptions,
          ),
        reply: (input: SessionPermissionReplyInput, requestOptions?: RequestOptions) =>
          request<SessionPermissionReplyOutput>(
            {
              method: "POST",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
              body: { reply: input["reply"], message: input["message"] },
              successStatus: 204,
              declaredStatuses: [403, 404],
              empty: true,
            },
            requestOptions,
          ),
      },
      form: {
        list: (input: SessionFormListInput, requestOptions?: RequestOptions) =>
          request<SessionFormListOutput>(
            {
              method: "GET",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/form`,
              successStatus: 200,
              declaredStatuses: [403, 404],
              empty: false,
            },
            requestOptions,
          ),
        reply: (input: SessionFormReplyInput, requestOptions?: RequestOptions) =>
          request<SessionFormReplyOutput>(
            {
              method: "POST",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}/reply`,
              body: { answer: input["answer"] },
              successStatus: 204,
              declaredStatuses: [400, 403, 404, 409],
              empty: true,
            },
            requestOptions,
          ),
        cancel: (input: SessionFormCancelInput, requestOptions?: RequestOptions) =>
          request<SessionFormCancelOutput>(
            {
              method: "DELETE",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}`,
              successStatus: 204,
              declaredStatuses: [403, 404, 409],
              empty: true,
            },
            requestOptions,
          ),
      },
      prompt: (input: SessionPromptInput, requestOptions?: RequestOptions) =>
        request<SessionPromptOutput>(
          {
            method: "POST",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/prompt`,
            body: {
              id: input["id"],
              text: input["text"],
              delivery: input["delivery"],
              resume: input["resume"],
              agents: input["agents"],
              skills: input["skills"],
            },
            successStatus: 200,
            declaredStatuses: [403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      compact: (input: SessionCompactInput, requestOptions?: RequestOptions) =>
        request<SessionCompactOutput>(
          {
            method: "POST",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/compact`,
            body: { id: input["id"] },
            successStatus: 200,
            declaredStatuses: [403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      interrupt: (input: SessionInterruptInput, requestOptions?: RequestOptions) =>
        request<SessionInterruptOutput>(
          {
            method: "POST",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/interrupt`,
            query: { resume: input["resume"] },
            successStatus: 204,
            declaredStatuses: [403, 404],
            empty: true,
          },
          requestOptions,
        ),
      background: (input: SessionBackgroundInput, requestOptions?: RequestOptions) =>
        request<SessionBackgroundOutput>(
          {
            method: "POST",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/background`,
            successStatus: 204,
            declaredStatuses: [403, 404],
            empty: true,
          },
          requestOptions,
        ),
      rename: (input: SessionRenameInput, requestOptions?: RequestOptions) =>
        request<SessionRenameOutput>(
          {
            method: "PATCH",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}`,
            body: { title: input["title"] },
            successStatus: 204,
            declaredStatuses: [403, 404],
            empty: true,
          },
          requestOptions,
        ),
      revert: {
        stage: (input: SessionRevertStageInput, requestOptions?: RequestOptions) =>
          request<SessionRevertStageOutput>(
            {
              method: "POST",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/revert`,
              body: { messageID: input["messageID"] },
              successStatus: 200,
              declaredStatuses: [403, 404, 409],
              empty: false,
            },
            requestOptions,
          ),
        clear: (input: SessionRevertClearInput, requestOptions?: RequestOptions) =>
          request<SessionRevertClearOutput>(
            {
              method: "DELETE",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/revert`,
              successStatus: 204,
              declaredStatuses: [403, 404, 409],
              empty: true,
            },
            requestOptions,
          ),
        commit: (input: SessionRevertCommitInput, requestOptions?: RequestOptions) =>
          request<SessionRevertCommitOutput>(
            {
              method: "POST",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
              successStatus: 204,
              declaredStatuses: [403, 404, 409],
              empty: true,
            },
            requestOptions,
          ),
      },
      command: (input: SessionCommandInput, requestOptions?: RequestOptions) =>
        request<SessionCommandOutput>(
          {
            method: "POST",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/command`,
            body: {
              name: input["name"],
              text: input["text"],
              delivery: input["delivery"],
              agents: input["agents"],
              skills: input["skills"],
            },
            successStatus: 204,
            declaredStatuses: [403, 404],
            empty: true,
          },
          requestOptions,
        ),
      model: {
        switch: (input: SessionModelSwitchInput, requestOptions?: RequestOptions) =>
          request<SessionModelSwitchOutput>(
            {
              method: "POST",
              path: `/chat/session/${encodeURIComponent(input.sessionID)}/model`,
              body: { model: input["model"] },
              successStatus: 204,
              declaredStatuses: [400, 403, 404],
              empty: true,
            },
            requestOptions,
          ),
      },
      status: (requestOptions?: RequestOptions) =>
        request<SessionStatusOutput>(
          { method: "GET", path: `/chat/status`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    shell: {
      list: (input: ShellListInput, requestOptions?: RequestOptions) =>
        request<ShellListOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/shell`,
            successStatus: 200,
            declaredStatuses: [403, 404],
            empty: false,
          },
          requestOptions,
        ),
      output: (input: ShellOutputInput, requestOptions?: RequestOptions) =>
        request<ShellOutputOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/shell/${encodeURIComponent(input.shellID)}/output`,
            query: { cursor: input["cursor"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [403, 404],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ShellRemoveInput, requestOptions?: RequestOptions) =>
        request<ShellRemoveOutput>(
          {
            method: "DELETE",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/shell/${encodeURIComponent(input.shellID)}`,
            successStatus: 204,
            declaredStatuses: [403, 404],
            empty: true,
          },
          requestOptions,
        ),
    },
    agent: {
      list: (input: AgentListInput, requestOptions?: RequestOptions) =>
        request<AgentListOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/agent`,
            successStatus: 200,
            declaredStatuses: [403, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    skill: {
      list: (input: SkillListInput, requestOptions?: RequestOptions) =>
        request<SkillListOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/skill`,
            successStatus: 200,
            declaredStatuses: [403, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    command: {
      list: (input: CommandListInput, requestOptions?: RequestOptions) =>
        request<CommandListOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/command`,
            successStatus: 200,
            declaredStatuses: [403, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    file: {
      search: (input: FileSearchInput, requestOptions?: RequestOptions) =>
        request<FileSearchOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/file`,
            query: { query: input["query"], type: input["type"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [403, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    websearch: {
      providers: (input: WebsearchProvidersInput, requestOptions?: RequestOptions) =>
        request<WebsearchProvidersOutput>(
          {
            method: "GET",
            path: `/chat/session/${encodeURIComponent(input.sessionID)}/websearch/provider`,
            successStatus: 200,
            declaredStatuses: [403, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
  }
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return
  if (value === null) {
    params.append(key, "null")
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType", { detail: response.headers.get("content-type") })
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

type DeclaredErrorBody = {
  readonly _tag?: string
  readonly message?: string
  readonly data?: { readonly message?: string }
}

/** Throw declared error bodies as Errors. The body's fields stay on the error, so narrowing on `_tag` or `name` still works. */
function declared(body: DeclaredErrorBody) {
  const error = Object.assign(new Error(body.message ?? body.data?.message), body)
  if (body._tag) error.name = body._tag
  return error
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
