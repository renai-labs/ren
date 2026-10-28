export * as InfraFolder from "./folder.js"

import { Infra } from "@ren/schema/infra"
import { Predicate, Result, Schema, SchemaIssue } from "effect"
import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { Output } from "../services/output.js"

export type Validated =
  | { readonly kind: "org"; readonly spec: Infra.Spec; readonly bindings?: Infra.Bindings; readonly problems: [] }
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
  if (kind === "environment" || records.some((record) => record === kind))
    return [`${space}/${kind}.yaml`, rest.slice(1)]
  if (isInstructions(rest)) return [`${space}/instructions.md`, []]
  return [`${space}/space.yaml`, rest]
}

const locate = (keys: ReadonlyArray<string>): Place => {
  if (keys.at(0) === "org") return isInstructions(keys.slice(1)) ? ["instructions.md", []] : ["org.yaml", keys.slice(1)]
  if (keys.at(0) !== "spaces" || keys.length < 2) return [".", keys]
  return inSpace(`spaces/${keys.at(1)}`, keys.slice(2))
}

const list = async (root: string) =>
  existsSync(root) ? (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true }))).toSorted() : []

const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u

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
    const others = files.filter((file) => file.startsWith(folder) && file !== `${folder}SKILL.md`)
    const contents = await Promise.all(
      others.map(async (file) => ({ file, bytes: await Bun.file(join(root, file)).bytes() })),
    )
    problems.push(
      ...contents
        .filter((content) => content.bytes.includes(0))
        .map((content) => ({ path: content.file, message: "A skill holds text files only." })),
    )
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
      files: Object.fromEntries(
        contents
          .filter((content) => !content.bytes.includes(0))
          .map((content) => [content.file.slice(folder.length), new TextDecoder().decode(content.bytes)]),
      ),
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
  const all = [
    ...problems,
    ...issues(spec).map((issue) => problem(...locate(issue.keys), issue.message)),
    ...issues(bindings).map((issue) => problem("deploy.yaml", issue.keys, issue.message)),
  ].toSorted((left, right) => Output.formatProblem(left).localeCompare(Output.formatProblem(right)))
  if (all.length > 0 || Result.isFailure(spec) || (bindings && Result.isFailure(bindings)))
    return { kind: "invalid", problems: all }
  return { kind: "org", spec: spec.success, ...(bindings ? { bindings: bindings.success } : {}), problems: [] }
}

const dump = (value: unknown) => `${Bun.YAML.stringify(value, null, 2).replaceAll(/ +$/gmu, "")}\n`

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

type PulledSkill = NonNullable<PulledApp["skills"]>[string]

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
  const previous = existing.includes("SKILL.md") ? frontmatter.exec(await Bun.file(join(folder, "SKILL.md")).text()) : null
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
  const skills = Object.entries(app.skills ?? {})
  const existing = children(await list(folder), "skills/")
  await Promise.all(
    existing
      .filter((slug) => !(slug in (app.skills ?? {})))
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
    record(join(folder, "mcps.yaml"), app.mcps ?? {}),
    ...skills.map(([slug, skill]) => writeSkill(join(folder, "skills", slug), slug, skill)),
  ])
}

const writeBindings = async (root: string, pulled: typeof Infra.Pulled.Encoded) => {
  const deploy = Bun.file(join(root, "deploy.yaml"))
  const parsed = (await deploy.exists()) ? Bun.YAML.parse(await deploy.text()) : {}
  const current = Predicate.isObject(parsed) ? parsed : {}
  const spaces = Predicate.isObject(current["spaces"]) ? current["spaces"] : {}
  const slugs = [...new Set([...Object.keys(spaces), ...Object.keys(pulled.bindings.spaces)])].toSorted()
  const written = Object.fromEntries(
    slugs.flatMap((slug) => {
      const before = Predicate.isObject(spaces[slug]) ? spaces[slug] : {}
      const kept = Object.fromEntries(
        Object.entries(before).filter(([key]) => key !== "channels" && key !== "profiles"),
      )
      const pulledSpace = pulled.bindings.spaces[slug]
      const merged = {
        ...kept,
        ...(pulledSpace?.channels && Object.keys(pulledSpace.channels).length > 0 && { channels: pulledSpace.channels }),
        ...(pulledSpace?.profiles && Object.keys(pulledSpace.profiles).length > 0 && { profiles: pulledSpace.profiles }),
      }
      return Object.keys(merged).length > 0 ? [[slug, merged]] : []
    }),
  )
  const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== "spaces"))
  await Bun.write(
    deploy,
    dump({
      ...rest,
      organization: pulled.bindings.organization,
      ...(Object.keys(written).length > 0 && { spaces: written }),
    }),
  )
}

export const write = async (root: string, pulled: typeof Infra.Pulled.Encoded) => {
  await mkdir(root, { recursive: true })
  const files = await list(root)
  const instructions = async (folder: string, text: string | undefined) => {
    const path = join(root, folder, "instructions.md")
    if (text) await Bun.write(path, `${text}\n`)
    else await rm(path, { force: true })
  }
  await writeBindings(root, pulled)
  const org = compact(pulled.spec.org.settings)
  await Bun.write(join(root, "org.yaml"), org.settings ? dump(org) : "settings: {}\n")
  await instructions("", pulled.spec.org.settings.instructions)
  const spaces = Object.entries(pulled.spec.spaces)
  await Promise.all(
    [
      ...children(files, "spaces/")
        .filter((slug) => !(slug in pulled.spec.spaces))
        .map((slug) => `spaces/${slug}`),
      ...spaces.flatMap(([slug, space]) =>
        children(files, `spaces/${slug}/agents/`)
          .filter((name) => !(name in space.agents))
          .map((name) => `spaces/${slug}/agents/${name}`),
      ),
      ...spaces.flatMap(([slug, space]) =>
        children(files, `spaces/${slug}/apps/`)
          .filter((name) => !(name in space.apps))
          .map((name) => `spaces/${slug}/apps/${name}`),
      ),
    ].map((folder) => rm(join(root, folder), { recursive: true, force: true })),
  )
  await Promise.all([
    ...spaces.flatMap(([slug, space]) => {
      const folder = `spaces/${slug}`
      return [
        Bun.write(
          join(root, folder, "space.yaml"),
          dump({
            name: space.name,
            ...(Predicate.isString(space.description) && { description: space.description }),
            ...compact(space.settings),
            ...(space.factory && { factory: space.factory }),
            ...(space.uses.agents?.length ? { uses: { agents: space.uses.agents } } : {}),
          }),
        ),
        instructions(folder, space.settings.instructions),
        record(join(root, folder, "schedules.yaml"), space.schedules),
        record(join(root, folder, "channels.yaml"), space.channels),
        ...Object.entries(space.apps).map(([name, app]) => writeApp(join(root, folder, "apps", name), app)),
      ]
    }),
    ...spaces.flatMap(([slug, space]) =>
      Object.entries(space.agents).flatMap(([name, agent]) => {
        const folder = `spaces/${slug}/agents/${name}`
        return [
          Bun.write(
            join(root, folder, "agent.yaml"),
            dump({
              ...(Predicate.isString(agent.description) && { description: agent.description }),
              ...(agent.isSubagent && { isSubagent: true }),
              ...(agent.settings && compact(agent.settings)),
            }),
          ),
          instructions(folder, agent.settings?.instructions),
        ]
      }),
    ),
  ])
}
