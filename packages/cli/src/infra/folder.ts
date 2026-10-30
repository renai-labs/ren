export * as InfraFolder from "./folder.js"

import { Infra } from "@ren/schema/infra"
import { Predicate, Result, Schema, SchemaIssue } from "effect"
import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { Output } from "../services/output.js"

export type Validated =
  | {
      readonly kind: "org"
      readonly spec: Infra.Spec
      readonly bindings?: Infra.Bindings
      readonly lock?: Infra.Lock
      readonly problems: []
    }
  | { readonly kind: "invalid"; readonly problems: ReadonlyArray<Output.Problem> }

const records = ["schedules", "webhooks", "channels"] as const

const formatter = SchemaIssue.makeFormatterStandardSchemaV1()

const children = (files: ReadonlyArray<string>, prefix: string) =>
  [
    ...new Set(
      files
        .filter((file) => file.startsWith(prefix) && file.slice(prefix.length).includes("/"))
        .map((file) => file.slice(prefix.length).split("/").at(0) ?? ""),
    ),
  ].toSorted()

const problem = (file: string, keys: ReadonlyArray<string>, message: string): Output.Problem =>
  keys.length > 0 ? { path: file, field: keys.join("."), message } : { path: file, message }

const isInstructions = (keys: ReadonlyArray<string>) => keys.at(0) === "settings" && keys.at(1) === "instructions"

type Place = readonly [file: string, keys: ReadonlyArray<string>]

const inApp = (app: string, rest: ReadonlyArray<string>): Place => {
  if (rest.at(0) === "skills" && rest.length >= 2) return [`${app}/skills/${rest.at(1)}`, rest.slice(2)]
  if (rest.at(0) === "mcps") return [`${app}/mcps.yaml`, rest.slice(1)]
  return [`${app}/app.yaml`, rest]
}

const inSpace = (space: string, rest: ReadonlyArray<string>): Place => {
  const kind = rest.at(0)
  if (kind === "agents" && rest.length >= 2) {
    const agent = `${space}/agents/${rest.at(1)}`
    return isInstructions(rest.slice(2)) ? [`${agent}/instructions.md`, []] : [`${agent}/agent.yaml`, rest.slice(2)]
  }
  if (kind === "apps" && rest.length >= 2) return inApp(`${space}/apps/${rest.at(1)}`, rest.slice(2))
  if (kind === "memory") return [`${space}/memory`, []]
  if (kind === "environment" || records.some((record) => record === kind))
    return [`${space}/${kind}.yaml`, rest.slice(1)]
  if (isInstructions(rest)) return [`${space}/instructions.md`, []]
  return [`${space}/space.yaml`, rest]
}

const locate = (keys: ReadonlyArray<string>): Place => {
  if (keys.at(0) === "org") return isInstructions(keys.slice(1)) ? ["instructions.md", []] : ["org.yaml", keys.slice(1)]
  if (keys.at(0) === "memory") return ["memory", []]
  if (keys.at(0) !== "spaces" || keys.length < 2) return [".", keys]
  return inSpace(`spaces/${keys.at(1)}`, keys.slice(2))
}

const list = async (root: string) =>
  existsSync(root) ? (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true }))).toSorted() : []

const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u

const lockFile = "ren.lock"

export const lock = async (
  root: string,
): Promise<{ readonly lock?: Infra.Lock; readonly problems: Array<Output.Problem> }> => {
  const file = Bun.file(join(root, lockFile))
  if (!(await file.exists())) return { problems: [] }
  const content = await file.text()
  const decoded = Result.try(() => Bun.YAML.parse(content)).pipe(
    Result.flatMap((parsed) => Schema.decodeUnknownResult(Infra.Lock)(parsed)),
  )
  return Result.isSuccess(decoded)
    ? { lock: decoded.success, problems: [] }
    : {
        problems: [
          { path: lockFile, message: "Ren did not write this lock. Restore it from git, or pull into a new folder." },
        ],
      }
}

export const validate = async (root: string): Promise<Validated> => {
  const files = await list(root)
  const present = new Set(files)
  const problems: Array<Output.Problem> = []

  const text = (file: string) => Bun.file(join(root, file)).text()

  const yaml = async (file: string): Promise<unknown> => {
    if (!present.has(file)) return undefined
    const content = await text(file)
    return Result.try({ try: () => Bun.YAML.parse(content), catch: (error) => error }).pipe(
      Result.match({
        onSuccess: (value) => value,
        onFailure: (error) => {
          problems.push({ path: file, message: `Invalid YAML: ${String(error)}` })
          return
        },
      }),
    )
  }

  const markdown = async (file: string) =>
    present.has(file) ? (await text(file)).replace(/\n$/u, "") || undefined : undefined

  const settled = async (folder: string, file: string) => {
    const value = (await yaml(`${folder}${file}`)) ?? {}
    const instructions = await markdown(`${folder}instructions.md`)
    if (!instructions || !Predicate.isObject(value)) return value
    const settings = value["settings"] ?? {}
    if (!Predicate.isObject(settings)) return value
    if ("instructions" in settings)
      problems.push({ path: folder.slice(0, -1) || ".", message: "Put the instructions in instructions.md only." })
    return { ...value, settings: { ...settings, instructions } }
  }

  const textFiles = async (folder: string, noun: string, skip?: string) => {
    const contents = await Promise.all(
      files
        .filter((file) => file.startsWith(folder) && file !== `${folder}${skip}`)
        .map(async (file) => ({ file, bytes: await Bun.file(join(root, file)).bytes() })),
    )
    problems.push(
      ...contents
        .filter((content) => content.bytes.includes(0))
        .map((content) => ({ path: content.file, message: `${noun} holds text files only.` })),
    )
    return Object.fromEntries(
      contents
        .filter((content) => !content.bytes.includes(0))
        .map((content) => [content.file.slice(folder.length), new TextDecoder().decode(content.bytes)]),
    )
  }

  const skill = async (folder: string, slug: string) => {
    if (present.has(`${folder}skill.yaml`)) {
      if (present.has(`${folder}SKILL.md`))
        problems.push({ path: folder.slice(0, -1), message: "Use SKILL.md or skill.yaml, not both." })
      const upstream = await yaml(`${folder}skill.yaml`)
      return Predicate.isObject(upstream) ? { type: "upstream", ...upstream } : upstream
    }
    if (!present.has(`${folder}SKILL.md`)) {
      problems.push({ path: folder.slice(0, -1), message: "A skill folder needs SKILL.md or skill.yaml." })
      return
    }
    const others = await textFiles(folder, "A skill", "SKILL.md")
    const match = frontmatter.exec(await text(`${folder}SKILL.md`))
    const header = Result.try(() => Bun.YAML.parse(match?.at(1) ?? "")).pipe(Result.getOrUndefined)
    const data = Predicate.isObject(header) ? header : {}
    if (data["name"] !== slug)
      problems.push({
        path: `${folder}SKILL.md`,
        field: "name",
        message: `The name “${String(data["name"])}” must be the folder name, ${slug}.`,
      })
    const metadata = data["metadata"]
    return {
      type: "content",
      description: data["description"],
      ...(Predicate.isObject(metadata) && "requiredCredentials" in metadata
        ? { requiredCredentials: metadata["requiredCredentials"] }
        : {}),
      instructions: match?.at(2) ?? "",
      files: others,
    }
  }

  const entries = async <A>(names: ReadonlyArray<string>, read: (name: string) => Promise<A>) =>
    Object.fromEntries(
      (await Promise.all(names.map(async (name) => [name, await read(name)] as const))).filter(
        ([, value]) => !Predicate.isUndefined(value),
      ),
    )

  const app = async (folder: string) => {
    const value = (await yaml(`${folder}app.yaml`)) ?? {}
    if (!Predicate.isObject(value)) return value
    const mcps = await yaml(`${folder}mcps.yaml`)
    return {
      ...value,
      ...(!Predicate.isUndefined(mcps) && { mcps }),
      skills: await entries(children(files, `${folder}skills/`), (slug) => skill(`${folder}skills/${slug}/`, slug)),
    }
  }

  const space = async (folder: string) => {
    const value = await settled(folder, "space.yaml")
    if (!Predicate.isObject(value)) return value
    const owned = await Promise.all(
      [...records, "environment"].map(async (kind) => [kind, await yaml(`${folder}${kind}.yaml`)] as const),
    )
    return {
      ...value,
      ...Object.fromEntries(owned.filter(([, value]) => !Predicate.isUndefined(value))),
      agents: await entries(children(files, `${folder}agents/`), (name) =>
        settled(`${folder}agents/${name}/`, "agent.yaml"),
      ),
      apps: await entries(children(files, `${folder}apps/`), (slug) => app(`${folder}apps/${slug}/`)),
      memory: await textFiles(`${folder}memory/`, "A memory"),
    }
  }

  if (!present.has("org.yaml"))
    return {
      kind: "invalid",
      problems: [
        present.has("space.yaml")
          ? { path: "space.yaml", message: "Private specs are not supported yet." }
          : { path: ".", message: "No spec here. An org spec has org.yaml, and a private spec has space.yaml." },
      ],
    }

  const input = {
    org: await settled("", "org.yaml"),
    memory: await textFiles("memory/", "A memory"),
    spaces: await entries(children(files, "spaces/"), (slug) => space(`spaces/${slug}/`)),
  }
  const deploy = await yaml("deploy.yaml")
  const spec = Schema.decodeUnknownResult(Infra.Spec)(input, { errors: "all" })
  const bindings = Predicate.isUndefined(deploy)
    ? undefined
    : Schema.decodeUnknownResult(Infra.Bindings)(deploy, { errors: "all" })
  const issues = (result: Result.Result<unknown, Schema.SchemaError> | undefined) =>
    result && Result.isFailure(result)
      ? formatter(result.failure.issue).issues.map((issue) => ({
          keys: (issue.path ?? []).map((segment) => String(typeof segment === "object" ? segment.key : segment)),
          message: issue.message,
        }))
      : []
  const locked = await lock(root)
  const all = [
    ...problems,
    ...locked.problems,
    ...issues(spec).map((issue) => problem(...locate(issue.keys), issue.message)),
    ...issues(bindings).map((issue) => problem("deploy.yaml", issue.keys, issue.message)),
  ].toSorted((left, right) => Output.formatProblem(left).localeCompare(Output.formatProblem(right)))
  if (all.length > 0 || Result.isFailure(spec) || (bindings && Result.isFailure(bindings)))
    return { kind: "invalid", problems: all }
  return {
    kind: "org",
    spec: spec.success,
    ...(bindings ? { bindings: bindings.success } : {}),
    ...(locked.lock ? { lock: locked.lock } : {}),
    problems: [],
  }
}

const dump = (value: unknown) => `${Bun.YAML.stringify(value, null, 2).replaceAll(/ +$/gmu, "")}\n`

export const writeLock = (root: string, value: Infra.Lock) =>
  Bun.write(join(root, lockFile), dump(Schema.encodeSync(Infra.Lock)(value)))

const compact = (settings: (typeof Infra.Pulled.Encoded)["spec"]["org"]["settings"]) => {
  const kept = Object.entries(settings).filter(
    ([key, value]) => key !== "instructions" && !(Array.isArray(value) && value.length === 0),
  )
  return kept.length > 0 ? { settings: Object.fromEntries(kept) } : {}
}

type PulledSpace = (typeof Infra.Pulled.Encoded)["spec"]["spaces"][string]

type PulledApp = PulledSpace["apps"][string]

const nonEmpty = <A>(key: string, values: ReadonlyArray<A> | undefined) =>
  values && values.length > 0 ? { [key]: values } : {}

const record = async (path: string, value: Record<string, unknown>) =>
  Object.keys(value).length > 0 ? Bun.write(path, dump(value)) : rm(path, { force: true })

type PulledSkill = PulledApp["skills"][string]

const writeSkill = async (folder: string, slug: string, skill: PulledSkill) => {
  const existing = await list(folder)
  if (skill.type === "upstream") {
    await Promise.all(existing.map((file) => rm(join(folder, file), { force: true })))
    await Bun.write(
      join(folder, "skill.yaml"),
      dump({ ...nonEmpty("requiredCredentials", skill.requiredCredentials), upstream: skill.upstream }),
    )
    return
  }
  const previous = existing.includes("SKILL.md")
    ? frontmatter.exec(await Bun.file(join(folder, "SKILL.md")).text())
    : null
  const parsed = Result.try(() => Bun.YAML.parse(previous?.at(1) ?? "")).pipe(Result.getOrUndefined)
  const header = Predicate.isObject(parsed) ? parsed : {}
  const metadata = Predicate.isObject(header["metadata"]) ? header["metadata"] : {}
  const kept = Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "requiredCredentials"))
  const merged = { ...kept, ...nonEmpty("requiredCredentials", skill.requiredCredentials) }
  const files = skill.files ?? {}
  await Promise.all(
    existing
      .filter((file) => file !== "SKILL.md" && !(file in files))
      .map((file) => rm(join(folder, file), { force: true })),
  )
  await Promise.all([
    Bun.write(
      join(folder, "SKILL.md"),
      `---\n${dump({ ...header, name: slug, description: skill.description, ...(Object.keys(merged).length > 0 ? { metadata: merged } : {}) })}---\n${skill.instructions}`,
    ),
    ...Object.entries(files).map(([file, content]) => Bun.write(join(folder, file), content)),
  ])
}

const writeApp = async (folder: string, app: PulledApp) => {
  const skills = Object.entries(app.skills)
  const existing = children(await list(folder), "skills/")
  await Promise.all(
    existing
      .filter((slug) => !(slug in app.skills))
      .map((slug) => rm(join(folder, "skills", slug), { recursive: true, force: true })),
  )
  await Promise.all([
    Bun.write(
      join(folder, "app.yaml"),
      dump({
        name: app.name,
        description: app.description,
        ...(app.icon && { icon: app.icon }),
        ...nonEmpty("requiredCredentials", app.requiredCredentials),
        ...(app.environment && { environment: app.environment }),
        ...nonEmpty("dependsOn", app.dependsOn),
      }),
    ),
    record(join(folder, "mcps.yaml"), app.mcps),
    ...skills.map(([slug, skill]) => writeSkill(join(folder, "skills", slug), slug, skill)),
  ])
}

const fields = (value: unknown): Record<string, unknown> => (Predicate.isObject(value) ? { ...value } : {})

const parsed = async (path: string) => {
  const file = Bun.file(path)
  if (!(await file.exists())) return {}
  const content = await file.text()
  return fields(Result.try(() => Bun.YAML.parse(content)).pipe(Result.getOrUndefined))
}

const without = (value: Record<string, unknown>, keys: ReadonlyArray<string>) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))

const filled = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => !Predicate.isUndefined(entry) && !(Predicate.isObject(entry) && Object.keys(entry).length === 0),
    ),
  )

const replaced = (
  current: Readonly<Record<string, unknown>>,
  names: ReadonlyArray<string>,
  value: (name: string) => unknown,
) =>
  Object.fromEntries(
    [...new Set([...Object.keys(current), ...names])].flatMap((name) => {
      const next = names.includes(name) ? value(name) : current[name]
      return Predicate.isUndefined(next) ? [] : [[name, next]]
    }),
  )

const relisted = (before: unknown, names: ReadonlyArray<string>, listed: (name: string) => boolean) => [
  ...(Array.isArray(before) ? before.filter(Predicate.isString) : []).filter((name) => !names.includes(name)),
  ...names.filter(listed),
]

export const write = async (root: string, pulled: typeof Infra.Pulled.Encoded) => {
  await mkdir(root, { recursive: true })
  const writes = new Set(pulled.write)
  const removes = new Set(pulled.remove)
  const paths = [...writes, ...removes]
  const under = (prefix: string) =>
    paths.flatMap((path) => (path.startsWith(prefix) ? [path.slice(prefix.length)] : [])).toSorted()
  const instructions = async (folder: string, text: string | undefined) => {
    const path = join(root, folder, "instructions.md")
    if (text) await Bun.write(path, `${text}\n`)
    else await rm(path, { force: true })
  }
  const memory = (folder: string, files: Readonly<Record<string, string>> | undefined) =>
    Promise.all(
      under(`${folder}memory/`).map((name) => {
        const content = writes.has(`${folder}memory/${name}`) ? files?.[name] : undefined
        const path = join(root, folder, "memory", name)
        return Predicate.isString(content) ? Bun.write(path, content) : rm(path, { force: true })
      }),
    )
  await memory("", pulled.spec.memory)

  if (writes.has("org")) {
    const org = compact(pulled.spec.org.settings)
    await Bun.write(join(root, "org.yaml"), org.settings ? dump(org) : "settings: {}\n")
    await instructions("", pulled.spec.org.settings.instructions)
  }

  const deploy = join(root, "deploy.yaml")
  const bound = await parsed(deploy)
  const bindings = under("deploy.yaml/spaces/")
  const channelBindings = paths.filter((path) => /^spaces\/[^/]+\/channels\//u.test(path))
  if (
    !(await Bun.file(deploy).exists()) ||
    bindings.length > 0 ||
    channelBindings.length > 0 ||
    bound["organization"] !== pulled.bindings.organization
  ) {
    const spaces = fields(bound["spaces"])
    const slugs = [
      ...new Set([
        ...bindings.map((path) => path.split("/").at(0) ?? ""),
        ...channelBindings.map((path) => path.split("/").at(1) ?? ""),
      ]),
    ]
    const written = Object.fromEntries(
      [...new Set([...Object.keys(spaces), ...slugs])].flatMap((slug) => {
        if (!slugs.includes(slug)) return [[slug, spaces[slug]]]
        const space = fields(spaces[slug])
        const prefix = `spaces/${slug}/channels/`
        const channels = replaced(
          fields(space["channels"]),
          channelBindings.flatMap((path) => (path.startsWith(prefix) ? [path.slice(prefix.length)] : [])),
          (name) => (writes.has(`${prefix}${name}`) ? pulled.bindings.spaces[slug]?.channels?.[name] : undefined),
        )
        const listed = bindings.flatMap((path) =>
          path.startsWith(`${slug}/profiles/`) ? [path.slice(`${slug}/profiles/`.length)] : [],
        )
        const current = fields(space["profiles"])
        const profiles = replaced(current, [...new Set(listed.map((path) => path.split("/").at(0) ?? ""))], (app) => {
          const kept = relisted(
            current[app],
            listed.flatMap((path) => (path.startsWith(`${app}/`) ? [path.slice(app.length + 1)] : [])),
            (name) => writes.has(`deploy.yaml/spaces/${slug}/profiles/${app}/${name}`),
          )
          return kept.length > 0 ? kept : undefined
        })
        const kept = filled({ ...space, channels, profiles })
        return Object.keys(kept).length > 0 ? [[slug, kept]] : []
      }),
    )
    await Bun.write(
      deploy,
      dump(filled({ ...without(bound, ["spaces"]), organization: pulled.bindings.organization, spaces: written })),
    )
  }

  const slugs = [...new Set(under("spaces/").map((path) => path.split("/").at(0) ?? ""))]
  await Promise.all(
    slugs.map(async (slug) => {
      const folder = `spaces/${slug}`
      if (removes.has(folder)) return rm(join(root, folder), { recursive: true, force: true })
      const space = pulled.spec.spaces[slug]
      const own = under(`${folder}/`)
      const named = (kind: string) =>
        own.flatMap((path) => (path.startsWith(`${kind}/`) ? [path.slice(kind.length + 1)] : []))
      const uses = named("uses/agents")
      if (writes.has(folder) || uses.length > 0) {
        const file = join(root, folder, "space.yaml")
        const current = await parsed(file)
        const base =
          writes.has(folder) && space
            ? {
                ...without(current, ["name", "description", "settings", "factory"]),
                name: space.name,
                ...(Predicate.isString(space.description) && { description: space.description }),
                ...compact(space.settings),
                ...(space.factory && { factory: space.factory }),
              }
            : current
        const listed = relisted(fields(base["uses"])["agents"], uses, (name) =>
          writes.has(`${folder}/uses/agents/${name}`),
        )
        await Bun.write(
          file,
          dump({
            ...without(base, ["uses"]),
            ...(listed.length > 0 && { uses: { ...fields(base["uses"]), agents: listed } }),
          }),
        )
        if (writes.has(folder)) await instructions(folder, space?.settings.instructions)
      }
      const records = (["schedules", "channels"] as const).map(async (kind) => {
        const names = named(kind)
        if (names.length === 0) return
        const file = join(root, folder, `${kind}.yaml`)
        const entries: Record<string, unknown> = space?.[kind] ?? {}
        await record(
          file,
          replaced(await parsed(file), names, (name) =>
            writes.has(`${folder}/${kind}/${name}`) ? entries[name] : undefined,
          ),
        )
      })
      const agents = named("agents").map(async (name) => {
        const at = `${folder}/agents/${name}`
        const agent = space?.agents[name]
        if (!writes.has(at) || !agent) return rm(join(root, at), { recursive: true, force: true })
        const file = join(root, at, "agent.yaml")
        await Bun.write(
          file,
          dump({
            ...without(await parsed(file), ["description", "isSubagent", "settings"]),
            ...(Predicate.isString(agent.description) && { description: agent.description }),
            ...(agent.isSubagent && { isSubagent: true }),
            ...(agent.settings && compact(agent.settings)),
          }),
        )
        await instructions(at, agent.settings?.instructions)
      })
      const apps = named("apps").map((name) => {
        const at = join(root, folder, "apps", name)
        const app = space?.apps[name]
        return writes.has(`${folder}/apps/${name}`) && app
          ? writeApp(at, app)
          : rm(at, { recursive: true, force: true })
      })
      await Promise.all([...records, ...agents, ...apps, memory(`${folder}/`, space?.memory)])
    }),
  )
}
