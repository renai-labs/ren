export * as AppDraft from "./app-draft.js"

import type { McpInspectionResult } from "@ren/client"
import { App } from "@ren/schema/app"
import { Primitive } from "@ren/schema/primitive"
import { Slug } from "@ren/util/slug"
import { Result, Schema, SchemaIssue } from "effect"
import { parseDocument, stringify } from "yaml"
import { McpInspect } from "./mcp-inspect.js"

export type Source = Omit<typeof App.Declaration.Encoded, "icon"> & { readonly icon?: string | null | undefined }
type McpSource = NonNullable<Source["mcps"]>[string]
type SkillSource = NonNullable<Source["skills"]>[string]
type Requirement = NonNullable<Source["requiredCredentials"]>[number]

export type Choice = "none" | "oauth" | "bearer" | "apiKey" | "basic"
export type KeyIn = "header" | "query"
export type Endpoint = "none" | "client_secret_basic" | "client_secret_post"

export const choices: ReadonlyArray<{
  readonly value: Choice
  readonly label: string
  readonly unavailable?: string | undefined
}> = [
  { value: "none", label: "No Auth" },
  { value: "oauth", label: "OAuth 2.0" },
  { value: "bearer", label: "Bearer Token" },
  { value: "apiKey", label: "API Key" },
  { value: "basic", label: "Basic Auth", unavailable: "Not supported for now" },
]

export const endpoints: ReadonlyArray<{ readonly value: Endpoint; readonly label: string }> = [
  { value: "none", label: "None (public client)" },
  { value: "client_secret_basic", label: "Client secret, basic" },
  { value: "client_secret_post", label: "Client secret, post" },
]

const credentialNames = { bearer: "bearerToken", apiKey: "apiKey", user: "user", pass: "pass" } as const

const choiceByValue = new Map(choices.map((choice) => [choice.value, choice]))

const unavailableOf = (choice: Choice) => choiceByValue.get(choice)?.unavailable

export interface Auth {
  readonly choice?: Choice | undefined
  readonly scopes: string
  readonly clientId: string
  readonly endpoint: Endpoint
  readonly header: string
  readonly keyIn: KeyIn
  readonly credential?: string | undefined
  readonly user?: string | undefined
  readonly pass?: string | undefined
}

export interface Values {
  readonly token: string
  readonly apiKey: string
  readonly user: string
  readonly pass: string
}

export interface Row {
  readonly key: string
  readonly name: string
  readonly value: string
}

export interface Mcp {
  readonly key: string
  readonly source: string
  readonly slug?: string | undefined
  readonly name?: string | undefined
  readonly description?: string | undefined
  readonly cwd?: string | undefined
  readonly auth: Auth
  readonly values: Values
  readonly env: ReadonlyArray<Row>
  readonly secrets: ReadonlyArray<Row>
  readonly timeouts: { readonly startup: string; readonly catalog: string; readonly execution: string }
  readonly extra: ReadonlyArray<Requirement>
  readonly kept?: McpSource | undefined
}

export interface Draft {
  readonly name?: string | undefined
  readonly slug?: string | undefined
  readonly description?: string | undefined
  readonly icon?: string | null | undefined
  readonly mcps: ReadonlyArray<Mcp>
  readonly skills: ReadonlyArray<{ readonly slug: string; readonly skill: SkillSource }>
  readonly packages: { readonly apt: string; readonly npm: string; readonly pip: string; readonly go: string }
  readonly buildCommands: string
  readonly dependsOn: ReadonlyArray<string>
  readonly secrets: ReadonlyArray<Row>
  readonly extra: ReadonlyArray<Requirement>
  readonly webhooks: Source["webhooks"]
}

export type Inspected = (url: string) => McpInspectionResult | undefined

export const keyOf = () => crypto.randomUUID()

const emptyAuth: Auth = { scopes: "", clientId: "", endpoint: "none", header: "", keyIn: "header" }

const emptyValues: Values = { token: "", apiKey: "", user: "", pass: "" }

export const emptyMcp = (): Mcp => ({
  key: keyOf(),
  source: "",
  auth: emptyAuth,
  values: emptyValues,
  env: [],
  secrets: [],
  timeouts: { startup: "", catalog: "", execution: "" },
  extra: [],
})

export const empty = (): Draft => ({
  mcps: [emptyMcp()],
  skills: [],
  packages: { apt: "", npm: "", pip: "", go: "" },
  buildCommands: "",
  dependsOn: [],
  secrets: [],
  extra: [],
  webhooks: {},
})

const quoted = /"([^"]*)"|'([^']*)'|(\S+)/gu

const commandOf = (text: string) => [...text.matchAll(quoted)].map((match) => match[1] ?? match[2] ?? match[3] ?? "")

const sourceOfCommand = (command: ReadonlyArray<string>) =>
  command.map((part) => (/[\s"]/u.test(part) ? `'${part}'` : part)).join(" ")

export const isLocal = (mcp: Pick<Mcp, "source" | "kept">) =>
  !mcp.kept && mcp.source.trim().length > 0 && !McpInspect.urlOf(mcp.source) && !/^https?:/iu.test(mcp.source.trim())

const runnerWords = new Set(["run", "dlx", "exec", "x"])

const localNameOf = (source: string) => {
  const parts = commandOf(source)
  const target = parts.slice(1).find((part) => !part.startsWith("-") && !runnerWords.has(part)) ?? parts.at(0) ?? ""
  return (target.split("/").at(-1) ?? target).replace(/@[^@]*$/u, "") || target
}

const httpsIcon = (icon: string | undefined) => (icon && URL.parse(icon)?.protocol === "https:" ? icon : undefined)

const choiceOf = (inspection: McpInspectionResult | undefined): Choice | undefined => {
  const auth = inspection?.auth.type
  if (auth === "oauth" || auth === "bearer") return auth
  if (auth === "basic") return unavailableOf("basic") ? undefined : "basic"
  return "none"
}

export interface Resolved {
  readonly mcp: Mcp
  readonly url: URL | undefined
  readonly local: boolean
  readonly inspection: McpInspectionResult | undefined
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly choice: Choice | undefined
  readonly header: string
}

export interface Identity {
  readonly name: string
  readonly slug: string
  readonly description: string
  readonly icon: string | null
}

interface Part {
  readonly mcp: Mcp
  readonly url: URL | undefined
  readonly local: boolean
  readonly inspection: McpInspectionResult | undefined
  readonly title: string
  readonly about: string
  readonly icon: string | undefined
}

type Skill = Draft["skills"][number]

const titleOf = (inspection: McpInspectionResult | undefined, url: URL | undefined, command: string | undefined) => {
  const server = inspection?.server
  return server?.title || server?.name || url?.hostname || (command ? localNameOf(command) : "")
}

const aboutOf = (inspection: McpInspectionResult | undefined, url: URL | undefined) =>
  inspection?.server?.description || (url ? `Tools from ${url.hostname}` : "")

const faviconOf = (url: URL | undefined) =>
  url?.protocol === "https:" ? `https://${url.hostname}/favicon.ico` : undefined

const partOf = (mcp: Mcp, inspected: Inspected): Part => {
  const url = mcp.kept ? undefined : McpInspect.urlOf(mcp.source)
  const inspection = url?.protocol === "https:" ? inspected(url.href) : undefined
  const local = isLocal(mcp)
  return {
    mcp,
    url,
    local,
    inspection,
    title: titleOf(inspection, url, local ? mcp.source : undefined),
    about: aboutOf(inspection, url),
    icon: httpsIcon(inspection?.server?.icon) ?? faviconOf(url),
  }
}

const skillAbout = (skill: Skill | undefined) =>
  skill?.skill.type === "content" ? skill.skill.description : (skill?.slug ?? "")

const nameOf = (draft: Draft, first: Part | undefined, skill: Skill | undefined) =>
  draft.name ?? (first?.title || skill?.slug || "")

const descriptionOf = (draft: Draft, first: Part | undefined, skill: Skill | undefined) =>
  draft.description ?? (first?.about || skillAbout(skill))

const identityOf = (draft: Draft, first: Part | undefined): Identity => {
  const skill = draft.skills.at(0)
  const name = nameOf(draft, first, skill)
  return {
    name,
    slug: draft.slug ?? Slug.of(name, Primitive.maximumSlugLength),
    description: descriptionOf(draft, first, skill),
    icon: draft.icon === undefined ? (first?.icon ?? null) : draft.icon,
  }
}

const wantedSlug = (part: Part, input: { readonly only: boolean; readonly identity: Identity }) =>
  part.mcp.slug ??
  (input.only ? input.identity.slug : Slug.of(part.inspection?.server?.name || part.title, Primitive.maximumSlugLength))

const resolvedOf = (
  part: Part,
  input: { readonly only: boolean; readonly identity: Identity; readonly slug: string },
) => {
  const mcp = part.mcp
  const resolved: Resolved = {
    mcp,
    url: part.url,
    local: part.local,
    inspection: part.inspection,
    slug: input.slug,
    name: mcp.name ?? (input.only ? input.identity.name : part.title),
    description: mcp.description ?? (input.only ? input.identity.description : part.about),
    choice: mcp.auth.choice ?? choiceOf(part.inspection),
    header: mcp.auth.header || (mcp.auth.keyIn === "query" ? "api_key" : "X-API-Key"),
  }
  return resolved
}

export const resolve = (draft: Draft, inspected: Inspected) => {
  const parts = draft.mcps
    .filter((mcp) => mcp.kept !== undefined || mcp.source.trim().length > 0)
    .map((mcp) => partOf(mcp, inspected))
  const identity = identityOf(draft, parts.at(0))
  const only = parts.length === 1
  const taken = new Set<string>()
  const mcps = parts.map((part) => {
    const slug = Slug.free(wantedSlug(part, { only, identity }) || "mcp", taken, Primitive.maximumSlugLength)
    taken.add(slug)
    return resolvedOf(part, { only, identity, slug })
  })
  return { identity, mcps }
}

const secret = (name: string) => ({ kind: "secret", name }) as const

const env = (name: string) => ({ kind: "env", name }) as const

interface Built {
  readonly auth: Readonly<Record<string, unknown>>
  readonly requirements: ReadonlyArray<{ readonly kind: string; readonly name: string }>
}

const oauthOf = (resolved: Resolved): Built => {
  const auth = resolved.mcp.auth
  const scopes = auth.scopes.split(/[\s,]+/u).filter(Boolean)
  const clientId = auth.clientId.trim()
  const inspected = resolved.inspection?.auth
  const needsOrgApp = inspected?.type === "oauth" && inspected.client === "oauth-app"
  return {
    auth: {
      type: "oauth",
      tokenEndpointAuth: clientId ? auth.endpoint : "none",
      ...(scopes.length > 0 && { scopes }),
      ...(clientId && { client: { clientId } }),
    },
    requirements: needsOrgApp ? [{ kind: "oauth_app", name: resolved.name }] : [],
  }
}

const builders: Readonly<Record<Choice, (resolved: Resolved) => Built>> = {
  none: () => ({ auth: { type: "none" }, requirements: [] }),
  oauth: oauthOf,
  bearer: (resolved) => {
    const credential = resolved.mcp.auth.credential ?? credentialNames.bearer
    return { auth: { type: "bearer", credential }, requirements: [secret(credential)] }
  },
  apiKey: (resolved) => {
    const auth = resolved.mcp.auth
    const credential = auth.credential ?? credentialNames.apiKey
    return { auth: { type: auth.keyIn, name: resolved.header, credential }, requirements: [secret(credential)] }
  },
  basic: (resolved) => {
    const user = resolved.mcp.auth.user ?? credentialNames.user
    const pass = resolved.mcp.auth.pass ?? credentialNames.pass
    return { auth: { type: "basic", username: user, password: pass }, requirements: [secret(user), secret(pass)] }
  },
}

const withoutNamed = (extra: ReadonlyArray<Requirement>, named: ReadonlyArray<{ readonly name: string }>) => {
  const names = new Set(named.map((each) => each.name))
  return extra.filter((requirement) => !names.has(requirement.name))
}

const timeoutsOf = (timeouts: Mcp["timeouts"]) => {
  const set = Object.entries(timeouts).flatMap(([stage, value]) =>
    value.trim() ? [[stage, Number(value)] as const] : [],
  )
  return set.length > 0 ? { timeouts: Object.fromEntries(set) } : {}
}

const filled = (rows: ReadonlyArray<Row>) => rows.filter((row) => row.name.trim())

const localDeclarationOf = (resolved: Resolved) => {
  const mcp = resolved.mcp
  const secrets = filled(mcp.secrets).map((row) => env(row.name.trim()))
  const literals = filled(mcp.env)
  return {
    name: resolved.name,
    description: resolved.description,
    transport: {
      type: "local",
      command: commandOf(mcp.source),
      ...(mcp.cwd && { cwd: mcp.cwd }),
      ...(literals.length > 0 && { env: Object.fromEntries(literals.map((row) => [row.name.trim(), row.value])) }),
    },
    auth: { type: "none" },
    ...timeoutsOf(mcp.timeouts),
    requiredCredentials: [...secrets, ...withoutNamed(mcp.extra, secrets)],
  }
}

const remoteDeclarationOf = (resolved: Resolved) => {
  const mcp = resolved.mcp
  const built = builders[resolved.choice ?? "none"](resolved)
  return {
    name: resolved.name,
    description: resolved.description,
    transport: { type: "remote", url: resolved.url?.href ?? mcp.source.trim() },
    auth: built.auth,
    ...timeoutsOf(mcp.timeouts),
    requiredCredentials: [...built.requirements, ...withoutNamed(mcp.extra, built.requirements)],
  }
}

const declarationOf = (resolved: Resolved) => {
  const kept = resolved.mcp.kept
  if (kept) return { ...kept, name: resolved.name, description: resolved.description }
  return resolved.local ? localDeclarationOf(resolved) : remoteDeclarationOf(resolved)
}

const words = (text: string) => text.split(/[\s,]+/u).filter(Boolean)

const environmentOf = (draft: Draft) => {
  const packages = Object.fromEntries(
    Object.entries(draft.packages).flatMap(([kind, text]) =>
      words(text).length > 0 ? [[kind, words(text)] as const] : [],
    ),
  )
  const buildCommands = draft.buildCommands
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  return Object.keys(packages).length > 0 || buildCommands.length > 0
    ? { environment: { packages, buildCommands } }
    : {}
}

export const candidateOf = (draft: Draft, inspected: Inspected) => {
  const resolved = resolve(draft, inspected)
  const identity = resolved.identity
  const icon = identity.icon?.trim()
  const secrets = filled(draft.secrets).map((row) => env(row.name.trim()))
  return {
    name: identity.name,
    description: identity.description,
    ...(icon && { icon }),
    requiredCredentials: [...secrets, ...withoutNamed(draft.extra, secrets)],
    ...environmentOf(draft),
    skills: Object.fromEntries(draft.skills.map((each) => [each.slug, each.skill])),
    mcps: Object.fromEntries(resolved.mcps.map((each) => [each.slug, declarationOf(each)])),
    dependsOn: draft.dependsOn,
    webhooks: draft.webhooks ?? {},
  }
}

export interface Problem {
  readonly path: string
  readonly message: string
}

export type Checked =
  | { readonly _tag: "valid"; readonly declaration: App.Declaration }
  | { readonly _tag: "invalid"; readonly problems: ReadonlyArray<Problem> }

const formatter = SchemaIssue.makeFormatterStandardSchemaV1()

const decode = Schema.decodeUnknownResult(App.Declaration)

const pathOf = (path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined) =>
  (path ?? []).map((segment) => String(typeof segment === "object" ? segment.key : segment)).join(".")

const check = (candidate: unknown): Checked => {
  const decoded = decode(candidate, { errors: "all" })
  if (Result.isSuccess(decoded)) return { _tag: "valid", declaration: decoded.success }
  return {
    _tag: "invalid",
    problems: formatter(decoded.failure.issue).issues.map((issue) => ({
      path: pathOf(issue.path),
      message: issue.message,
    })),
  }
}

const isSlug = Schema.is(Primitive.Slug)

const authProblems = (mcps: ReadonlyArray<Resolved>): ReadonlyArray<Problem> =>
  mcps.flatMap((each) => {
    if (each.mcp.kept || each.local) return []
    const path = `mcps.${each.slug}.auth`
    if (!each.choice) return [{ path, message: "Pick how Ren signs in to this server." }]
    const reason = unavailableOf(each.choice)
    if (!reason) return []
    const label = choiceByValue.get(each.choice)?.label ?? "This auth"
    return [{ path, message: `${label}: ${reason.toLowerCase()}. Pick another auth.` }]
  })

const formProblems = (draft: Draft, inspected: Inspected): ReadonlyArray<Problem> => {
  const resolved = resolve(draft, inspected)
  return [
    ...(isSlug(resolved.identity.slug)
      ? []
      : [{ path: "slug", message: "Use lowercase letters and digits, joined by single dashes, for the slug." }]),
    ...authProblems(resolved.mcps),
  ]
}

export const write = (candidate: unknown) => stringify(candidate)

export const read = (text: string): Checked => {
  const document = parseDocument(text)
  if (document.errors.length > 0)
    return {
      _tag: "invalid",
      problems: document.errors.map((error) => ({
        path: "",
        message: (error.message.split("\n").at(0) ?? error.message).replace(/:$/u, "."),
      })),
    }
  return check(document.toJS() ?? {})
}

export const label = (problem: Problem) => (problem.path ? `${problem.path}: ${problem.message}` : problem.message)

interface LooseAuth {
  readonly type: string
  readonly name?: string
  readonly credential?: string
  readonly username?: string
  readonly password?: string
  readonly scopes?: ReadonlyArray<string>
  readonly tokenEndpointAuth?: string
  readonly client?: { readonly clientId: string }
}

const isEndpoint = (value: string | undefined): value is Endpoint => endpoints.some((each) => each.value === value)

const apiKeyFrom = (loose: LooseAuth): Auth => ({
  ...emptyAuth,
  choice: "apiKey",
  header: loose.name ?? "",
  keyIn: loose.type === "query" ? "query" : "header",
  credential: loose.credential,
})

const authReaders: Readonly<Record<string, (loose: LooseAuth) => Auth | undefined>> = {
  none: () => ({ ...emptyAuth, choice: "none" }),
  oauth: (loose) => ({
    ...emptyAuth,
    choice: "oauth",
    scopes: (loose.scopes ?? []).join(" "),
    clientId: loose.client?.clientId ?? "",
    endpoint: isEndpoint(loose.tokenEndpointAuth) ? loose.tokenEndpointAuth : "none",
  }),
  bearer: (loose) => ({ ...emptyAuth, choice: "bearer", credential: loose.credential }),
  header: apiKeyFrom,
  query: apiKeyFrom,
  basic: (loose) =>
    unavailableOf("basic") ? undefined : { ...emptyAuth, choice: "basic", user: loose.username, pass: loose.password },
}

const namedBy = (loose: LooseAuth) =>
  [loose.credential, loose.username, loose.password].filter((name): name is string => name !== undefined)

const envRows = (requirements: ReadonlyArray<Requirement>) =>
  requirements.flatMap((requirement) =>
    requirement.kind === "env" ? [{ key: keyOf(), name: requirement.name, value: "" }] : [],
  )

const timeoutText = (timeouts: McpSource["timeouts"]) => ({
  startup: String(timeouts?.startup ?? ""),
  catalog: String(timeouts?.catalog ?? ""),
  execution: String(timeouts?.execution ?? ""),
})

interface McpInput {
  readonly slug: string
  readonly mcp: McpSource
  readonly previous: Mcp | undefined
  readonly app: { readonly name: string; readonly description: string } | undefined
}

const baseOf = (input: McpInput) => {
  const mcp = input.mcp
  return {
    key: input.previous?.key ?? keyOf(),
    slug: input.slug,
    name: mcp.name === input.app?.name ? undefined : mcp.name,
    description: mcp.description === input.app?.description ? undefined : mcp.description,
    values: input.previous?.values ?? emptyValues,
    timeouts: timeoutText(mcp.timeouts),
  }
}

const mcpFrom = (input: McpInput): Mcp => {
  const mcp = input.mcp
  const loose: LooseAuth = mcp.auth
  const auth = authReaders[loose.type]?.(loose)
  const requirements = mcp.requiredCredentials ?? []
  const transport = mcp.transport
  if (transport.type === "remote" && auth) {
    const named = new Set(namedBy(loose))
    return {
      ...baseOf(input),
      source: transport.url,
      auth,
      env: [],
      secrets: [],
      extra: requirements.filter((requirement) => !named.has(requirement.name)),
    }
  }
  if (transport.type === "local" && loose.type === "none")
    return {
      ...baseOf(input),
      source: sourceOfCommand(transport.command),
      cwd: transport.cwd,
      auth: emptyAuth,
      env: Object.entries(transport.env ?? {}).map(([name, value]) => ({ key: keyOf(), name, value })),
      secrets: envRows(requirements),
      extra: requirements.filter((requirement) => requirement.kind !== "env"),
    }
  return { ...emptyMcp(), ...baseOf(input), source: "", kept: mcp }
}

const joined = (list: ReadonlyArray<string> | undefined, separator = " ") => (list ?? []).join(separator)

const packagesOf = (environment: Source["environment"]) => {
  const packages = environment?.packages
  return {
    apt: joined(packages?.apt),
    npm: joined(packages?.npm),
    pip: joined(packages?.pip),
    go: joined(packages?.go),
  }
}

const mcpsFrom = (source: Source, previous: Draft | undefined) => {
  const mcps = Object.entries(source.mcps ?? {})
  const earlier = new Map((previous?.mcps ?? []).map((mcp) => [mcp.slug, mcp]))
  return mcps.map(([slug, mcp]) =>
    mcpFrom({ slug, mcp, previous: earlier.get(slug), app: mcps.length === 1 ? source : undefined }),
  )
}

export const fromSource = (source: Source, previous?: Draft): Draft => {
  const requirements: ReadonlyArray<Requirement> = source.requiredCredentials ?? []
  return {
    name: source.name,
    slug: previous?.slug,
    description: source.description,
    icon: source.icon ?? null,
    mcps: mcpsFrom(source, previous),
    skills: Object.entries(source.skills ?? {}).map(([slug, skill]) => ({ slug, skill })),
    packages: packagesOf(source.environment),
    buildCommands: joined(source.environment?.buildCommands, "\n"),
    dependsOn: source.dependsOn ?? [],
    secrets: envRows(requirements),
    extra: requirements.filter((requirement) => requirement.kind !== "env"),
    webhooks: source.webhooks ?? {},
  }
}

type Pasted =
  | { readonly type: "fields"; readonly fields: Readonly<Record<string, string>> }
  | { readonly type: "basic"; readonly username: string; readonly password: string }

const fieldsOf = (name: string, value: string): Pasted | undefined =>
  value.trim() ? { type: "fields", fields: { [name]: value.trim() } } : undefined

const pastedOf: Readonly<Record<Choice, (mcp: Mcp) => Pasted | undefined>> = {
  none: () => undefined,
  oauth: () => undefined,
  bearer: (mcp) => fieldsOf(mcp.auth.credential ?? credentialNames.bearer, mcp.values.token),
  apiKey: (mcp) => fieldsOf(mcp.auth.credential ?? credentialNames.apiKey, mcp.values.apiKey),
  basic: (mcp) =>
    mcp.values.user.trim() && mcp.values.pass
      ? { type: "basic", username: mcp.values.user.trim(), password: mcp.values.pass }
      : undefined,
}

export const typedValues = (resolved: ReadonlyArray<Resolved>) =>
  resolved.flatMap((each) => {
    const host = each.url?.hostname
    const value = each.choice && !each.local && !each.mcp.kept ? pastedOf[each.choice](each.mcp) : undefined
    return host && value ? [{ slug: each.slug, host, value }] : []
  })

export const fromChecked = (checked: Checked, previous: Draft) =>
  checked._tag === "valid" ? { ...fromSource(checked.declaration, previous), slug: previous.slug } : undefined

export const problemsOf = (draft: Draft, inspected: Inspected) => {
  const checked = check(candidateOf(draft, inspected))
  return [...formProblems(draft, inspected), ...(checked._tag === "invalid" ? checked.problems : [])]
}

export const signsIn = (mcps: ReadonlyArray<Resolved>) =>
  mcps.some((each) => !each.local && !each.mcp.kept && each.choice === "oauth")

export const prepare = (draft: Draft, inspected: Inspected, spec: string | undefined) => {
  if (spec !== undefined) {
    const parsed = read(spec)
    const final = fromChecked(parsed, draft)
    return parsed._tag === "valid" && final ? { final, declaration: parsed.declaration } : undefined
  }
  if (formProblems(draft, inspected).length > 0) return
  const checked = check(candidateOf(draft, inspected))
  return checked._tag === "valid" ? { final: draft, declaration: checked.declaration } : undefined
}
