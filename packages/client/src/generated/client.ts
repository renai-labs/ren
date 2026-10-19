import type {
  HealthGetOutput,
  MeGetOutput,
  InvitationPreviewInput,
  InvitationPreviewOutput,
  SpaceListInput,
  SpaceListOutput,
  SpaceGetInput,
  SpaceGetOutput,
  SpaceCreateInput,
  SpaceCreateOutput,
  SpaceUpdateInput,
  SpaceUpdateOutput,
  SpaceArchiveInput,
  SpaceArchiveOutput,
  SpaceMemberListInput,
  SpaceMemberListOutput,
  SpaceMemberCreateInput,
  SpaceMemberCreateOutput,
  SpaceMemberArchiveInput,
  SpaceMemberArchiveOutput,
  EnvironmentListInput,
  EnvironmentListOutput,
  EnvironmentGetInput,
  EnvironmentGetOutput,
  EnvironmentCreateInput,
  EnvironmentCreateOutput,
  EnvironmentUpdateInput,
  EnvironmentUpdateOutput,
  EnvironmentArchiveInput,
  EnvironmentArchiveOutput,
  HandProviderListOutput,
  SpaceEnvironmentListInput,
  SpaceEnvironmentListOutput,
  SpaceEnvironmentCreateInput,
  SpaceEnvironmentCreateOutput,
  SpaceEnvironmentArchiveInput,
  SpaceEnvironmentArchiveOutput,
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

  return {
    health: {
      get: (requestOptions?: RequestOptions) =>
        request<HealthGetOutput>(
          { method: "GET", path: `/health`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    me: {
      get: (requestOptions?: RequestOptions) =>
        request<MeGetOutput>(
          { method: "GET", path: `/me`, successStatus: 200, declaredStatuses: [401], empty: false },
          requestOptions,
        ),
    },
    invitation: {
      preview: (input: InvitationPreviewInput, requestOptions?: RequestOptions) =>
        request<InvitationPreviewOutput>(
          {
            method: "GET",
            path: `/invitations/${encodeURIComponent(input.id)}/preview`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    space: {
      list: (input: SpaceListInput, requestOptions?: RequestOptions) =>
        request<SpaceListOutput>(
          {
            method: "GET",
            path: `/spaces`,
            query: { joined: input["joined"], page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: SpaceGetInput, requestOptions?: RequestOptions) =>
        request<SpaceGetOutput>(
          {
            method: "GET",
            path: `/spaces/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: SpaceCreateInput, requestOptions?: RequestOptions) =>
        request<SpaceCreateOutput>(
          {
            method: "POST",
            path: `/spaces`,
            body: { name: input["name"], description: input["description"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: SpaceUpdateInput, requestOptions?: RequestOptions) =>
        request<SpaceUpdateOutput>(
          {
            method: "PATCH",
            path: `/spaces/${encodeURIComponent(input.id)}`,
            body: { name: input["name"], description: input["description"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: SpaceArchiveInput, requestOptions?: RequestOptions) =>
        request<SpaceArchiveOutput>(
          {
            method: "DELETE",
            path: `/spaces/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    "space-member": {
      list: (input: SpaceMemberListInput, requestOptions?: RequestOptions) =>
        request<SpaceMemberListOutput>(
          {
            method: "GET",
            path: `/space-members`,
            query: {
              spaceId: input["spaceId"],
              status: input["status"],
              page: input["page"],
              pageSize: input["pageSize"],
            },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: SpaceMemberCreateInput, requestOptions?: RequestOptions) =>
        request<SpaceMemberCreateOutput>(
          {
            method: "POST",
            path: `/space-members`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: SpaceMemberArchiveInput, requestOptions?: RequestOptions) =>
        request<SpaceMemberArchiveOutput>(
          {
            method: "DELETE",
            path: `/space-members/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    environment: {
      list: (input: EnvironmentListInput, requestOptions?: RequestOptions) =>
        request<EnvironmentListOutput>(
          {
            method: "GET",
            path: `/environments`,
            query: { page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: EnvironmentGetInput, requestOptions?: RequestOptions) =>
        request<EnvironmentGetOutput>(
          {
            method: "GET",
            path: `/environments/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: EnvironmentCreateInput, requestOptions?: RequestOptions) =>
        request<EnvironmentCreateOutput>(
          {
            method: "POST",
            path: `/environments`,
            body: {
              name: input["name"],
              description: input["description"],
              provider: input["provider"],
              config: input["config"],
              sessionsPerHand: input["sessionsPerHand"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: EnvironmentUpdateInput, requestOptions?: RequestOptions) =>
        request<EnvironmentUpdateOutput>(
          {
            method: "PATCH",
            path: `/environments/${encodeURIComponent(input.id)}`,
            body: {
              name: input["name"],
              description: input["description"],
              config: input["config"],
              sessionsPerHand: input["sessionsPerHand"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: EnvironmentArchiveInput, requestOptions?: RequestOptions) =>
        request<EnvironmentArchiveOutput>(
          {
            method: "DELETE",
            path: `/environments/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    handProvider: {
      list: (requestOptions?: RequestOptions) =>
        request<HandProviderListOutput>(
          { method: "GET", path: `/hand-providers`, successStatus: 200, declaredStatuses: [401, 403], empty: false },
          requestOptions,
        ),
    },
    "space-environment": {
      list: (input: SpaceEnvironmentListInput, requestOptions?: RequestOptions) =>
        request<SpaceEnvironmentListOutput>(
          {
            method: "GET",
            path: `/space-environments`,
            query: { spaceId: input["spaceId"], page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: SpaceEnvironmentCreateInput, requestOptions?: RequestOptions) =>
        request<SpaceEnvironmentCreateOutput>(
          {
            method: "POST",
            path: `/space-environments`,
            body: { spaceId: input["spaceId"], environmentId: input["environmentId"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: SpaceEnvironmentArchiveInput, requestOptions?: RequestOptions) =>
        request<SpaceEnvironmentArchiveOutput>(
          {
            method: "DELETE",
            path: `/space-environments/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
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
