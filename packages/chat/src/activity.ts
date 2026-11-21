export * as Activity from "./activity.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Option, Schema } from "effect"
import { ToolDisplay } from "./tool-display.js"
import { ToolState } from "./tool-state.js"

export interface Line {
  readonly text: string
  readonly kind: ToolDisplay.Kind | "thinking"
  readonly app?: string
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

const capitalize = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1)

const limit = (value: string) => (value.length > 80 ? `${value.slice(0, 79).trimEnd()}…` : value)

const basename = (value: unknown) => text(value)?.split(/[\\/]/u).findLast(Boolean)

const written = /"activity"\s*:\s*("(?:[^"\\]|\\.)*")/u

const decodeString = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String))

const activity = (tool: SessionMessage.Tool) => {
  const parsed = text(ToolState.input(tool).activity)
  if (parsed || tool.state.status !== "streaming") return parsed
  const match = written.exec(tool.state.input)?.at(1)
  return match ? text(Option.getOrUndefined(decodeString(match))) : undefined
}

const verbs: Readonly<Record<string, string>> = {
  get: "Reading",
  read: "Reading",
  fetch: "Fetching",
  list: "Listing",
  search: "Searching",
  find: "Finding",
  query: "Querying",
  create: "Creating",
  add: "Adding",
  update: "Updating",
  edit: "Editing",
  set: "Setting",
  delete: "Deleting",
  remove: "Removing",
  send: "Sending",
  post: "Posting",
  reply: "Replying to",
  comment: "Commenting on",
  close: "Closing",
  open: "Opening",
  merge: "Merging",
  run: "Running",
  start: "Starting",
  stop: "Stopping",
  move: "Moving",
  mark: "Marking",
  assign: "Assigning",
  archive: "Archiving",
  upload: "Uploading",
  download: "Downloading",
  check: "Checking",
  schedule: "Scheduling",
  draft: "Drafting",
  invite: "Inviting",
  share: "Sharing",
  sync: "Syncing",
  describe: "Describing",
  generate: "Generating",
  export: "Exporting",
  import: "Importing",
  publish: "Publishing",
  deploy: "Deploying",
  cancel: "Cancelling",
  approve: "Approving",
}

const words = (name: string) =>
  name
    .replaceAll(/([a-z])([A-Z])/gu, "$1 $2")
    .split(/[\s_\-.]+/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase())

const verbOf = (word: string | undefined) => (word && Object.hasOwn(verbs, word) ? verbs[word] : undefined)

const humanize = (name: string) => {
  const all = words(name)
  const first = verbOf(all.at(0))
  const last = all.length > 1 ? verbOf(all.at(-1)) : undefined
  const verb = first ?? last
  if (!verb) return `Using ${all.join(" ")}`
  const rest = first ? all.slice(1) : all.slice(0, -1)
  return rest.length ? `${verb} ${rest.join(" ")}` : verb
}

const appOf = (namespace: string) => {
  const app = namespace.split("__").at(0)
  return app && app !== "opencode" ? app : undefined
}

const code = (input: Readonly<Record<string, unknown>>): Line => {
  const found = ToolDisplay.codeCall(input.code)
  if (!found) return { text: "Running code", kind: "command" }
  if (found.namespace === "ren") return { text: ToolDisplay.renAction(found.name) ?? humanize(found.name), kind: "ren" }
  const app = appOf(found.namespace)
  return { text: humanize(found.name), kind: "tool", ...(app && { app }) }
}

const waiting = (step: string) => {
  const seconds = /^sleep\s+(\d+(?:\.\d+)?)s?\b/u.exec(step)?.at(1)
  if (!seconds) return
  return seconds === "1" ? "Waiting 1 second" : `Waiting ${seconds} seconds`
}

const plain: ReadonlyArray<{ readonly pattern: RegExp; readonly text: string }> = [
  { pattern: /^whoami\b/u, text: "Checking the current user" },
  { pattern: /^pwd\b/u, text: "Checking the current folder" },
  { pattern: /^date\b/u, text: "Checking the date and time" },
  { pattern: /^uname\b/u, text: "Checking the system" },
  { pattern: /^hostname\b/u, text: "Checking the machine name" },
  { pattern: /^uptime\b/u, text: "Checking how long the machine has run" },
  { pattern: /^(?:nproc|lscpu)\b/u, text: "Checking the processor" },
  { pattern: /^df\b/u, text: "Checking disk space" },
  { pattern: /^free\b/u, text: "Checking memory" },
  { pattern: /^(?:ps|top|htop)\b/u, text: "Checking running programs" },
  { pattern: /^(?:env|printenv)\b/u, text: "Checking the environment" },
  { pattern: /^which\b/u, text: "Finding a program" },
]

const commands: ReadonlyArray<{ readonly pattern: RegExp; readonly text: string }> = [
  { pattern: /\b(?:test|tests|pytest|vitest|jest)\b/u, text: "Running tests" },
  { pattern: /\b(?:install|add|ci)\b/u, text: "Installing dependencies" },
  { pattern: /\b(?:build|compile|tsc)\b/u, text: "Building the project" },
  { pattern: /\b(?:lint|format|fmt|check)\b/u, text: "Checking the code" },
  { pattern: /^git\s+(?:status|diff|log|show|branch)\b/u, text: "Checking the repository" },
  { pattern: /^git\s+(?:commit|add)\b/u, text: "Saving changes" },
  { pattern: /^git\s+(?:push|pull|fetch|clone)\b/u, text: "Syncing the repository" },
  { pattern: /^(?:curl|wget|http)\b/u, text: "Fetching from the web" },
  { pattern: /^(?:ls|find|tree|fd|du)\b/u, text: "Looking through files" },
  { pattern: /^(?:cat|head|tail|less|bat|wc)\b/u, text: "Reading a file" },
  { pattern: /^(?:grep|rg|ag)\b/u, text: "Searching the files" },
  { pattern: /^(?:mkdir|cp|mv|rm|touch)\b/u, text: "Organizing files" },
  { pattern: /^(?:python|python3|node|bun|deno|ruby|go\s+run)\b/u, text: "Running a script" },
]

const clis: Readonly<Record<string, string>> = {
  gh: "github",
  aws: "aws",
  gcloud: "google-cloud",
  vercel: "vercel",
  wrangler: "cloudflare",
  cf: "cloudflare",
  stripe: "stripe",
  linear: "linear",
  supabase: "supabase",
  railway: "railway",
  fly: "fly",
  heroku: "heroku",
}

const trivial = /^(?:cd|echo|printf|true|export|set)\b/u

const describe = (step: string) =>
  waiting(step) ??
  plain.find((entry) => entry.pattern.test(step))?.text ??
  commands.find((entry) => entry.pattern.test(step))?.text

const running = (command: string) => {
  const trimmed = command.trim()
  if (!trimmed) return "Running a command"
  if (trimmed.length <= 40) return `Running ${trimmed}`
  const program = trimmed.split(/\s+/u).at(0)?.split("/").findLast(Boolean)
  return program ? `Running ${program}` : "Running a command"
}

const shell = (command: string | undefined): Line => {
  const steps = (command ?? "").split(/&&|\|\||;|\|/u).map((step) => step.trim().replace(/^sudo\s+/u, ""))
  const cli = steps.map((step) => step.split(/\s+/u).at(0) ?? "").find((name) => Object.hasOwn(clis, name))
  const app = cli ? clis[cli] : undefined
  const known = steps
    .filter((step) => step && !trivial.test(step))
    .map((step) => describe(step))
    .find(Boolean)
  return { text: known ?? running(command ?? ""), kind: "command", ...(app && { app }) }
}

const host = (value: unknown) => {
  const url = text(value)
  return url && URL.canParse(url) ? new URL(url).hostname : undefined
}

type Input = Readonly<Record<string, unknown>>

const file = (input: Input) => basename(input.filePath) ?? basename(input.path)

const named = (verb: string, fallback: string) => (input: Input) => {
  const name = file(input)
  return name ? `${verb} ${name}` : fallback
}

const builtIns: Readonly<Record<string, (input: Input) => string | undefined>> = {
  read: named("Reading", "Reading a file"),
  show_file: named("Reading", "Reading a file"),
  write: named("Writing", "Writing a file"),
  edit: named("Editing", "Editing a file"),
  patch: () => "Editing files",
  apply_patch: () => "Editing files",
  glob: () => "Looking through files",
  list: () => "Looking through files",
  grep: (input) => (text(input.pattern) ? `Searching the code for ${text(input.pattern)}` : "Searching the code"),
  websearch: (input) => (text(input.query) ? `Searching the web for ${text(input.query)}` : "Searching the web"),
  webfetch: (input) => (host(input.url) ? `Reading ${host(input.url)}` : "Reading a web page"),
  skill: () => "Using a skill",

  experimental_image_generate: () => "Creating an image",
}

const fallbackOf = (tool: SessionMessage.Tool, input: Input): Line | undefined => {
  if (tool.name === "execute") return code(input)
  if (ToolDisplay.kind(tool) === "command") return shell(ToolDisplay.command(tool))
  return
}

export const of = (tool: SessionMessage.Tool): Line => {
  const input = ToolState.input(tool)
  const kind = ToolDisplay.kind(tool)
  const fallback = fallbackOf(tool, input)
  const written = activity(tool)
  if (written) return { ...fallback, kind: fallback?.kind ?? kind, text: limit(capitalize(written)) }
  if (fallback) return { ...fallback, text: limit(fallback.text) }
  if (tool.name === "question")
    return { text: ToolDisplay.status(tool) === "running" ? "Waiting for your answer" : "Asked for your input", kind }
  if (kind === "agent") return { text: limit(capitalize(text(input.description) ?? "Working on a task")), kind }
  const builtIn = Object.hasOwn(builtIns, tool.name) ? builtIns[tool.name]?.(input) : undefined
  return { text: limit(builtIn ?? ToolDisplay.label(tool)), kind }
}

const thinking: Line = { text: "Thinking", kind: "thinking" }

const unwritten = (tool: SessionMessage.Tool) => tool.state.status === "streaming" && !activity(tool)

export const listed = (content: SessionMessage.Content): content is SessionMessage.Tool =>
  content.type === "tool" && !ToolDisplay.hidden(content) && !unwritten(content)

export const current = (turn: ReadonlyArray<SessionMessage.Assistant>): Line | undefined => {
  const newest = turn
    .flatMap((message) => message.content)
    .findLast((content) => content.type === "reasoning" || listed(content))
  if (newest?.type === "tool") return of(newest)
  if (newest) return thinking
  const latest = turn.at(-1)
  return latest && !latest.time.completed && latest.content.at(-1)?.type === "text" ? undefined : thinking
}
