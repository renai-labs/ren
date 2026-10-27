import { BunFileSystem } from "@effect/platform-bun"
import { Compile, EmitCli, Write } from "@ren/httpapi-codegen"
import { ClientApi } from "@ren/protocol/client"
import { Exposure } from "@ren/protocol/exposure"
import { Primitive } from "@ren/protocol/primitive"
import { Context, Effect } from "effect"
import { fileURLToPath } from "node:url"

interface Resource {
  readonly group: string
  readonly about: string
  readonly names?: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly path: EmitCli.Path
  readonly name: string
  readonly one: string
  readonly many: string
  readonly alias?: string | false
  readonly parent?: string
  readonly verbs?: Readonly<Record<string, string>>
  readonly descriptions?: Readonly<Record<string, string>>
}

const resources: ReadonlyArray<Resource> = [
  { group: "space", about: "Manage spaces", path: ["space"], name: "space", one: "a space", many: "spaces" },
  {
    group: "space-member",
    about: "Manage space members",
    path: ["space", "member"],
    name: "member",
    one: "a space member",
    many: "a space’s members",
    parent: "spaceId",
    verbs: { create: "add", archive: "remove" },
    descriptions: { create: "Add a member to a space", archive: "Remove a member from a space" },
  },
  {
    group: "agent-membership",
    about: "Manage the agents in a space",
    path: ["space", "agent"],
    name: "membership",
    one: "an agent membership",
    many: "the agents in a space",
    alias: "agents",
    parent: "spaceId",
    verbs: { create: "add", archive: "remove" },
    descriptions: { create: "Add an agent to a space", archive: "Remove an agent from a space" },
  },
  {
    group: "space-environment-template",
    about: "Manage the environment templates of a space",
    path: ["space", "environment"],
    name: "environment",
    one: "a space environment",
    many: "a space’s environment templates",
    alias: "environments",
    parent: "spaceId",
    verbs: { create: "add", archive: "remove" },
    descriptions: {
      create: "Add an environment template to a space",
      archive: "Remove an environment template from a space",
    },
  },
  {
    group: "space-settings",
    about: "Manage a space’s settings",
    path: ["space", "settings"],
    name: "space",
    one: "a space’s settings",
    many: "space settings",
    descriptions: { get: "Show a space’s settings", update: "Update a space’s settings" },
  },
  {
    group: "organization-settings",
    about: "Manage the organization’s settings",
    path: ["org", "settings"],
    name: "org",
    one: "the organization’s settings",
    many: "organization settings",
    alias: false,
    descriptions: { get: "Show the organization’s settings", update: "Update the organization’s settings" },
  },
  {
    group: "agent",
    about: "Manage agents",
    path: ["agent"],
    name: "agent",
    one: "an agent",
    many: "agents",
    descriptions: { transferOwnership: "Move an agent to another space" },
  },
  {
    group: "app",
    about: "Manage apps",
    path: ["app"],
    name: "app",
    one: "an app",
    many: "apps",
    descriptions: { transferOwnership: "Move an app to another space" },
  },
  {
    group: "app-profile",
    about: "Manage app profiles",
    path: ["app", "profile"],
    name: "profile",
    one: "an app profile",
    many: "app profiles",
    descriptions: {
      access: "Change the spaces a shared profile reaches",
      link: "Choose the profile a dependency app uses",
      promote: "Share a private profile",
    },
    names: { link: { profileId: "to" } },
  },
  {
    group: "app-registry",
    about: "Browse the app registry",
    path: ["app", "registry"],
    name: "entry",
    one: "a registry app",
    many: "registry apps",
  },
  {
    group: "session",
    about: "Manage sessions",
    path: ["session"],
    name: "session",
    one: "a session",
    many: "sessions",
  },
  {
    group: "task",
    about: "Manage tasks",
    path: ["task"],
    name: "task",
    one: "a task",
    many: "tasks",
    descriptions: { assign: "Assign a task", start: "Start a task", review: "Review a task" },
  },
  {
    group: "task-comment",
    about: "Manage task comments",
    path: ["task", "comment"],
    name: "comment",
    one: "a comment",
    many: "a task’s comments",
    parent: "taskId",
    verbs: { create: "add", archive: "remove" },
    descriptions: { create: "Comment on a task", update: "Edit a comment", archive: "Remove a comment" },
  },
  {
    group: "task-activity",
    about: "Read a task’s activity",
    path: ["task", "activity"],
    name: "activity",
    one: "a task’s activity",
    many: "a task’s activity",
    alias: false,
    parent: "taskId",
  },
  { group: "label", about: "Manage labels", path: ["label"], name: "label", one: "a label", many: "labels" },
  {
    group: "schedule",
    about: "Manage schedules",
    path: ["schedule"],
    name: "schedule",
    one: "a schedule",
    many: "schedules",
    descriptions: { pause: "Pause a schedule", resume: "Resume a schedule", run: "Run a schedule now" },
  },
  {
    group: "credential",
    about: "Manage credentials",
    path: ["credential"],
    name: "credential",
    one: "a credential",
    many: "credentials",
    descriptions: {
      rotate: "Replace a credential’s value",
      move: "Move a credential to another owner",
      copy: "Copy a credential to another owner",
      remove: "Remove a credential",
    },
  },
  {
    group: "environment-template",
    about: "Manage environment templates",
    path: ["environment", "template"],
    name: "template",
    one: "an environment template",
    many: "environment templates",
  },
  {
    group: "oauth-app",
    about: "Manage OAuth apps",
    path: ["oauth", "app"],
    name: "app",
    one: "an OAuth app",
    many: "OAuth apps",
  },
  {
    group: "oauth-session",
    about: "Manage OAuth sessions",
    path: ["oauth", "session"],
    name: "session",
    one: "an OAuth session",
    many: "OAuth sessions",
  },
  {
    group: "channel-install",
    about: "Manage channel installs",
    path: ["channel", "install"],
    name: "install",
    one: "a channel install",
    many: "channel installs",
    descriptions: { remove: "Remove a channel install" },
  },
  {
    group: "channel-mapping",
    about: "Manage channel mappings",
    path: ["channel", "mapping"],
    name: "mapping",
    one: "a channel mapping",
    many: "channel mappings",
    descriptions: { remove: "Remove a channel mapping" },
  },
]

const groups: ReadonlyArray<EmitCli.Group> = [
  { path: ["org"], description: "Manage the organization" },
  { path: ["memory"], description: "Manage memory files" },
  { path: ["environment"], description: "Manage environments" },
  { path: ["oauth"], description: "Manage OAuth apps and sessions" },
  { path: ["channel"], description: "Manage channels" },
  { path: ["channel", "provider"], description: "Manage channel providers" },
  { path: ["channel", "place"], description: "Manage channel places" },
  { path: ["environment", "provider"], description: "Manage environment providers" },
  { path: ["inference"], description: "Manage inference providers" },
  { path: ["inference", "connection"], description: "Manage provider connections" },
  { path: ["repository"], description: "Manage repositories", alias: "repositories" },
]

const references: Readonly<
  Record<string, { readonly operation: string; readonly title: string; readonly name?: string }>
> = {
  spaceId: { operation: "space.get", title: "Space" },
  ownerSpaceId: { operation: "space.get", title: "Space", name: "space" },
  defaultSpaceId: { operation: "space.get", title: "Default space", name: "default-space" },
  agentId: { operation: "agent.get", title: "Agent" },
  appId: { operation: "app.get", title: "App" },
  taskId: { operation: "task.get", title: "Task" },
  parentId: { operation: "task.get", title: "Parent task" },
  scheduleId: { operation: "schedule.get", title: "Schedule" },
  environmentTemplateId: { operation: "environment-template.get", title: "Environment template", name: "template" },
  profileId: { operation: "app-profile.get", title: "App profile" },
}

const resolved = (name: string, operation: string) => ({
  names: { id: name },
  lookups: { id: { operation, input: "idOrSlug", output: "id" } },
  descriptions: { id: `${name.charAt(0).toUpperCase()}${name.slice(1)} slug or ID` },
})

const extra: ReadonlyArray<EmitCli.Command> = [
  {
    operation: "space.profiles",
    path: ["space", "profiles"],
    description: "List the profiles a new chat reaches",
    ...resolved("space", "space.get"),
  },
  {
    operation: "session.profiles",
    path: ["session", "profiles"],
    description: "List the profiles a chat reaches",
    ...resolved("session", "session.get"),
  },
  {
    operation: "app-profile.delete",
    path: ["app", "profile", "delete"],
    description: "Delete an app profile",
    ...resolved("profile", "app-profile.get"),
  },
  {
    operation: "schedule-run.list",
    path: ["schedule", "runs"],
    description: "List a schedule’s runs",
    arguments: ["scheduleId"],
  },
  { operation: "memory.list", path: ["memory", "list"] },
  { operation: "memory.read", path: ["memory", "read"], arguments: ["path"] },
  { operation: "memory.write", path: ["memory", "write"], arguments: ["path"] },
  { operation: "memory.edit", path: ["memory", "edit"], arguments: ["path"] },
  { operation: "memory.delete", path: ["memory", "delete"], arguments: ["path"] },
  { operation: "credential.connect", path: ["credential", "connect"], description: "Sign in to an MCP of a profile" },
  { operation: "environmentProvider.list", path: ["environment", "provider", "list"] },
  { operation: "channel-provider.list", path: ["channel", "provider", "list"] },
  { operation: "channel-place.list", path: ["channel", "place", "list"], names: { installId: "install" } },
  { operation: "channel-install.start", path: ["channel", "install", "start"] },
  { operation: "ren-inference.connection.list", path: ["inference", "connection", "list"] },
  {
    operation: "ren-inference.connection.rename",
    path: ["inference", "connection", "rename"],
    names: { id: "connection" },
    descriptions: { id: "Connection ID" },
  },
  {
    operation: "ren-inference.connection.remove",
    path: ["inference", "connection", "remove"],
    names: { id: "connection" },
    descriptions: { id: "Connection ID" },
  },
  { operation: "repository.list", path: ["repository", "list"] },
]

const elsewhere = new Map([
  ["health.get", "ren2 health"],
  ["me.get", "ren2 whoami"],
  ["infra.plan", "ren2 infra plan"],
  ["infra.apply", "ren2 infra apply"],
  ["infra.pull", "ren2 infra pull"],
  ["session.create", "A new session needs an ID the client makes; it comes with the chat commands."],
  ["chat.access", "Chat commands, which stream."],
  ["chat.messages", "Chat commands, which stream."],
  ["chat.retry", "Chat commands, which stream."],
  ["chat.prepare", "Chat commands, which stream."],
  ["chat.models", "Chat commands, which stream."],
  ["invitation.preview", "The sign-up page shows an invitation before its invitee signs in."],
  ["ren-inference.connect", "The provider sign-in returns to the app in a browser."],
])

const handwritten = new Set(["login", "logout", "whoami", "upgrade", "health", "infra", "api"])

const standard: Readonly<Record<string, (resource: Resource) => string>> = {
  list: (resource) => `List ${resource.many}`,
  get: (resource) => `Show ${resource.one}`,
  create: (resource) => `Create ${resource.one}`,
  update: (resource) => `Update ${resource.one}`,
  archive: (resource) => `Archive ${resource.one}`,
}

const contract = Compile.compile(ClientApi)

const sdk = Object.values(ClientApi.groups).filter(
  (group) => Context.getOrUndefined(group.annotations, Exposure) === "sdk",
)

const fieldsOf = (operation: string) => {
  const endpoint = contract.groups
    .flatMap((group) => group.endpoints)
    .find((each) => each.endpoint.identifier === operation)
  return endpoint === undefined ? [] : EmitCli.inputs(endpoint)
}

const capitalized = (text: string) => `${text.at(0)?.toUpperCase() ?? ""}${text.slice(1)}`

const kebab = (name: string) => name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

const shaped = (command: EmitCli.Command, own?: { readonly resource: Resource; readonly self: string | undefined }) => {
  const fields = fieldsOf(command.operation)
  const parent = own?.resource.parent
  const lookups = Object.fromEntries(
    fields.flatMap((field) => {
      const reference = references[field.name]
      if (reference !== undefined)
        return [[field.name, { operation: reference.operation, input: "idOrSlug", output: "id" }]]
      if (field.name === "id" && field.source === "params" && own?.self !== undefined)
        return [[field.name, { operation: own.self, input: "idOrSlug", output: "id" }]]
      return []
    }),
  )
  const names = Object.fromEntries(
    fields.flatMap((field) => {
      const reference = references[field.name]
      if (reference?.name !== undefined) return [[field.name, reference.name]]
      if (own !== undefined && field.source === "params" && (field.name === "id" || field.name === "idOrSlug"))
        return [[field.name, own.resource.name]]
      return []
    }),
  )
  const descriptions = Object.fromEntries(
    fields.flatMap((field) => {
      const reference = references[field.name]
      if (reference !== undefined) return [[field.name, `${reference.title} slug or ID`]]
      if (own === undefined || field.source !== "params") return []
      const title = capitalized(own.resource.name)
      if (field.name === "idOrSlug") return [[field.name, `${title} slug or ID`]]
      if (field.name === "id") return [[field.name, own.self === undefined ? `${title} ID` : `${title} slug or ID`]]
      return []
    }),
  )
  const parentField = fields.find((field) => field.name === parent)
  return {
    ...command,
    descriptions: { ...descriptions, ...command.descriptions },
    ...(parentField === undefined
      ? {}
      : {
          arguments: [
            parentField.name,
            ...fields.filter((field) => field.source === "params").map((field) => field.name),
          ],
        }),
    names: { ...names, ...command.names },
    lookups: { ...lookups, ...command.lookups },
  }
}

const groupOf = (resource: Resource) => {
  const group = sdk.find((each) => each.identifier === resource.group)
  if (group === undefined) throw new Error(`Not an SDK group: ${resource.group}`)
  return group
}

const definitionOf = (resource: Resource) => {
  const definition = Context.getOrUndefined(groupOf(resource).annotations, Primitive.Annotation)
  if (definition === undefined) throw new Error(`Not a primitive: ${resource.group}`)
  return definition
}

const primitive = resources.flatMap((resource) => {
  const self = definitionOf(resource).get === true ? `${resource.group}.get` : undefined
  return Object.keys(groupOf(resource).endpoints)
    .filter((operation) => !elsewhere.has(operation))
    .map((operation) => {
      const action = operation.slice(resource.group.length + 1)
      const description = resource.descriptions?.[action] ?? standard[action]?.(resource)
      if (description === undefined) throw new Error(`Describe ${operation} in the command table`)
      return shaped(
        {
          operation,
          path: [...resource.path, resource.verbs?.[action] ?? kebab(action)],
          description,
          ...(resource.names?.[action] === undefined ? {} : { names: resource.names[action] }),
        },
        { resource, self },
      )
    })
})

const aliased = resources.map((resource): EmitCli.Group => {
  const prefix = `${resource.path.slice(0, -1).join("-")}-`
  const plural = definitionOf(resource).plural
  const declared = plural.startsWith(prefix) ? plural.slice(prefix.length) : plural
  const alias = resource.alias === false ? undefined : (resource.alias ?? declared)
  if (alias === undefined || alias === resource.path.at(-1)) return { path: resource.path, description: resource.about }
  return { path: resource.path, description: resource.about, alias }
})

const commands = [...primitive, ...extra.map((command) => shaped(command))]

const placed = new Set([...commands.map((command) => command.operation), ...elsewhere.keys()])
const unplaced = sdk.flatMap((group) => Object.keys(group.endpoints)).filter((operation) => !placed.has(operation))
if (unplaced.length > 0) throw new Error(`Place these operations in the command table: ${unplaced.join(", ")}`)
const taken = commands.find((command) => handwritten.has(command.path[0]))
if (taken !== undefined) throw new Error(`Generated command collides with a handwritten one: ${taken.path.join(" ")}`)

await Effect.runPromise(
  Write.write(
    EmitCli.emitCli(contract, {
      module: "@renai-labs/sdk/effect",
      api: "ClientApi",
      runtime: "../operation.js",
      groups: [...groups, ...aliased],
      commands,
    }),
    fileURLToPath(new URL("../src/generated", import.meta.url)),
  ).pipe(Effect.provide(BunFileSystem.layer)),
)
