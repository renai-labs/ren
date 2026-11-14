export * as SkillFolder from "./skill-folder.js"

import { Credential } from "@ren/schema/credential"
import { Skill } from "@ren/schema/skill"
import { Slug } from "@ren/util/slug"
import { Result, Schema, SchemaIssue } from "effect"
import { parseDocument } from "yaml"
import type { FileDrop } from "../platform/file-drop.js"

export type Read =
  | { readonly _tag: "added"; readonly skills: ReadonlyArray<{ readonly slug: string; readonly skill: Skill.Content }> }
  | {
      readonly _tag: "refused"
      readonly folders: ReadonlyArray<{ readonly name: string; readonly problems: ReadonlyArray<string> }>
    }

type Folder = FileDrop.Entry

const skillFiles = ["SKILL.md", "skill.md"]

const ignored = (path: string) => path.split("/").at(-1) === ".DS_Store"

const formatter = SchemaIssue.makeFormatterStandardSchemaV1()

const decodeRequirements = Schema.decodeUnknownResult(Schema.Array(Credential.SkillRequirement))

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const textOf = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  const encoded = new TextEncoder().encode(text)
  const isText =
    !bytes.includes(0) && encoded.length === bytes.length && encoded.every((byte, at) => byte === bytes[at])
  return isText ? text : undefined
}

const frontmatterOf = (text: string) => {
  if (!text.startsWith("---")) return { problem: "SKILL.md must start with YAML frontmatter (---)" } as const
  const end = text.indexOf("---", 3)
  if (end === -1) return { problem: "SKILL.md frontmatter not properly closed with ---" } as const
  const document = parseDocument(text.slice(3, end))
  if (document.errors.length > 0)
    return {
      problem: `Invalid YAML in frontmatter: ${document.errors.map((error) => error.message.split("\n").at(0) ?? error.message).join(" ")}`,
    } as const
  const metadata: unknown = document.toJS()
  if (!isRecord(metadata)) return { problem: "SKILL.md frontmatter must be a YAML mapping" } as const
  return { metadata, body: text.slice(end + 3).trim() } as const
}

const requirementsOf = (metadata: Readonly<Record<string, unknown>>) => {
  const inner = metadata.metadata
  const listed = isRecord(inner) ? inner.requiredCredentials : undefined
  if (listed === undefined) return { requirements: [] }
  const decoded = decodeRequirements(listed, { errors: "all" })
  if (Result.isSuccess(decoded)) return { requirements: decoded.success }
  return {
    requirements: [],
    problems: formatter(decoded.failure.issue).issues.map(
      (issue) =>
        `metadata.requiredCredentials${(issue.path ?? []).map((segment) => `.${String(typeof segment === "object" ? segment.key : segment)}`).join("")}: ${issue.message}`,
    ),
  }
}

const readOne = async (folder: Folder) => {
  const byPath = new Map(folder.files.map((each) => [each.path, each]))
  const manifest = skillFiles.flatMap((name) => byPath.get(name) ?? []).at(0)
  if (!manifest) return { name: folder.name, problems: ["Missing required file: SKILL.md"] }
  const others = folder.files.filter((each) => each !== manifest && !ignored(each.path))
  const [manifestText, texts] = await Promise.all([
    textOf(manifest.file),
    Promise.all(others.map(async (each) => ({ path: each.path, text: await textOf(each.file) }))),
  ])
  const binary = texts.flatMap((each) => (each.text === undefined ? [`${each.path} is not a text file`] : []))
  if (manifestText === undefined)
    return { name: folder.name, problems: [`${manifest.path} is not a text file`, ...binary] }
  const parsed = frontmatterOf(manifestText)
  if ("problem" in parsed) return { name: folder.name, problems: [parsed.problem, ...binary] }
  const metadata = parsed.metadata
  const required = requirementsOf(metadata)
  const problems = [...Skill.validate(metadata, folder.name), ...(required.problems ?? []), ...binary]
  const description = typeof metadata.description === "string" ? metadata.description : ""
  const slug = typeof metadata.name === "string" ? metadata.name.trim() : folder.name
  return {
    name: folder.name,
    problems,
    slug,
    skill: {
      type: "content",
      description,
      requiredCredentials: required.requirements,
      instructions: parsed.body,
      files: Object.fromEntries(texts.flatMap((each) => (each.text === undefined ? [] : [[each.path, each.text]]))),
    } satisfies Skill.Content,
  }
}

const hasManifest = (folder: Folder) => folder.files.some((each) => skillFiles.includes(each.path))

const skillFoldersOf = (folder: Folder): ReadonlyArray<Folder> => {
  if (!folder.isFolder || hasManifest(folder)) return [folder]
  const inner = [
    ...Map.groupBy(
      folder.files.filter((each) => each.path.includes("/")),
      (each) => each.path.split("/").at(0) ?? "",
    ),
  ].map(([name, files]) => ({
    name,
    isFolder: true,
    files: files.map((each) => ({ path: each.path.split("/").slice(1).join("/"), file: each.file })),
  }))
  const skills = inner.filter(hasManifest)
  return skills.length > 0 ? skills : [folder]
}

export const read = async (dropped: ReadonlyArray<Folder>): Promise<Read> => {
  const loose = dropped.filter((each) => !each.isFolder)
  const folders = dropped.filter((each) => each.isFolder).flatMap(skillFoldersOf)
  const results = await Promise.all(folders.map(readOne))
  const refused = [
    ...loose.map((each) => ({ name: each.name, problems: [`“${each.name}” is a file. Drop the skill’s folder.`] })),
    ...results.filter((each) => each.problems.length > 0),
  ]
  if (refused.length > 0 || results.length === 0)
    return {
      _tag: "refused",
      folders:
        refused.length > 0 ? refused : [{ name: "the drop", problems: ["Drop a folder that holds a SKILL.md."] }],
    }
  return {
    _tag: "added",
    skills: results.flatMap((each) => (each.skill && each.slug ? [{ slug: each.slug, skill: each.skill }] : [])),
  }
}

const github = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/tree\/([^/\s]+)(?:\/(\S+?))?)?\/?$/u

export const fromGitHub = (text: string) => {
  const match = github.exec(text.trim())
  const owner = match?.[1]
  const repository = match?.[2]
  if (!owner || !repository) return
  const path = match[4] ?? "."
  return {
    slug: Slug.of(path === "." ? repository : (path.split("/").at(-1) ?? repository), 64),
    skill: {
      type: "upstream",
      requiredCredentials: [],
      upstream: {
        url: `https://github.com/${owner}/${repository}.git`,
        ...(match[3] && { ref: match[3] }),
        path,
      },
    } satisfies Skill.Upstream,
  }
}
