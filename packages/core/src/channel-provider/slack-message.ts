export * as SlackMessage from "./slack-message.js"

import type { Channel } from "@ren/schema/channel"
import { Predicate } from "effect"

export interface Raw {
  readonly user?: string
  readonly text?: string
  readonly blocks?: unknown
  readonly attachments?: unknown
  readonly files?: unknown
}

type Node = Readonly<Record<string, unknown>>

interface Context {
  readonly bot: string | undefined
  readonly listed: Set<string>
}

const textTypes = new Set(["text", "mrkdwn", "plain_text", "markdown"])

const leafTypes = new Set(["link", "emoji", "user", "usergroup", "channel", "broadcast", "date"])

const contentKeys = [
  "elements",
  "text",
  "fields",
  "title",
  "description",
  "label",
  "caption",
  "alt_text",
  "blocks",
  "items",
  "rows",
  "cells",
  "columns",
  "sections",
  "content",
]

const separatedTypes = new Set(["section", "header", "context", "markdown", "image", "video"])

const isNode: (value: unknown) => value is Node = Predicate.isObject

const nodes = (value: unknown): ReadonlyArray<Node> => (Array.isArray(value) ? value.filter(isNode) : [])

const field = (node: Node, key: string) => {
  const value = node[key]
  return typeof value === "string" ? value : ""
}

const count = (node: Node, key: string) => {
  const value = node[key]
  return typeof value === "number" ? value : 0
}

const filled = (part: string) => part.length > 0

const user = (context: Context, id: string) => {
  if (!id) return "@unknown"
  return id === context.bot ? "" : `<@${id}>`
}

const unescaped = (text: string) => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")

const tokens = (text: string, context: Context) =>
  unescaped(
    text
      .replaceAll(/<!subteam\^[A-Z0-9]+(?:\|([^>]+))?>/giu, (_, label?: string) => label ?? "@team")
      .replaceAll(/<!(here|channel|everyone)>/giu, (_, name: string) => `@${name}`)
      .replaceAll(/<#([A-Z0-9]+)(?:\|([^>]+))?>/giu, (_, id: string, label?: string) =>
        label ? `#${label}` : `<#${id}>`,
      )
      .replaceAll(/<((?:https?|mailto):[^|>]+)(?:\|([^>]+))?>/giu, (_, url: string, label?: string) => {
        const address = url.startsWith("mailto:") ? url.slice("mailto:".length) : url
        return label && label !== address ? `[${label}](${url})` : address
      })
      .replaceAll(/<@([A-Z0-9]+)>/giu, (_, id: string) => user(context, id)),
  ).trim()

const styled = (text: string, style: unknown) => {
  if (!text || !isNode(style)) return text
  const code = style.code === true ? `\`${text}\`` : text
  const bold = style.bold === true ? `**${code}**` : code
  const italic = style.italic === true ? `*${bold}*` : bold
  return style.strike === true ? `~~${italic}~~` : italic
}

const emoji = (node: Node) => {
  const points = field(node, "unicode")
    .split("-")
    .map((hex) => Number.parseInt(hex, 16))
  const name = field(node, "name")
  if (points.every((point) => Number.isInteger(point) && point >= 0 && point <= 0x10_ffff))
    return String.fromCodePoint(...points)
  return name ? `:${name}:` : ""
}

const link = (node: Node) => {
  const url = field(node, "url")
  const label = field(node, "text")
  return styled(label && label !== url ? `[${label}](${url})` : url, node.style)
}

const date = (node: Node) => {
  const fallback = field(node, "fallback")
  if (fallback) return fallback
  return typeof node.timestamp === "number" ? new Date(node.timestamp * 1000).toISOString() : ""
}

const inline = (node: Node, context: Context): string => {
  switch (field(node, "type")) {
    case "text":
      return styled(field(node, "text"), node.style)
    case "link":
      return link(node)
    case "emoji":
      return emoji(node)
    case "user":
      return user(context, field(node, "user_id"))
    case "usergroup":
      return "@group"
    case "channel":
      return `<#${field(node, "channel_id")}>`
    case "broadcast":
      return field(node, "range") ? `@${field(node, "range")}` : ""
    case "date":
      return date(node)
    default:
      return ""
  }
}

const inlines = (elements: unknown, context: Context) =>
  nodes(elements)
    .map((node) => inline(node, context))
    .join("")

const plain = (elements: unknown, context: Context) =>
  nodes(elements)
    .map((node) => {
      const type = field(node, "type")
      if (type === "text") return field(node, "text")
      if (type === "link") return field(node, "url")
      return inline(node, context)
    })
    .join("")

const flattened = (value: unknown, context: Context): string => {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map((each: unknown) => flattened(each, context)).join("")
  if (!isNode(value)) return ""
  const type = field(value, "type")
  if (type === "mrkdwn") return tokens(field(value, "text"), context)
  if (textTypes.has(type) && typeof value.text === "string") return value.text
  if (leafTypes.has(type)) return inline(value, context)
  const inner = contentKeys
    .flatMap((key) => (key in value ? [flattened(value[key], context)] : []))
    .filter(filled)
    .join("\n")
  return separatedTypes.has(type) ? `${inner}\n` : inner
}

const block = (node: Node, context: Context): string => {
  switch (field(node, "type")) {
    case "rich_text":
      return nodes(node.elements)
        .map((each) => block(each, context))
        .filter(filled)
        .join("\n")
    case "rich_text_section":
      return inlines(node.elements, context)
    case "rich_text_list": {
      const indent = "  ".repeat(count(node, "indent"))
      const offset = count(node, "offset")
      return nodes(node.elements)
        .map(
          (item, index) =>
            `${indent}${node.style === "ordered" ? `${offset + index + 1}.` : "-"} ${inlines(item.elements, context)}`,
        )
        .join("\n")
    }
    case "rich_text_quote":
      return inlines(node.elements, context)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")
    case "rich_text_preformatted":
      return `\`\`\`${field(node, "language")}\n${plain(node.elements, context)}\n\`\`\``
    default:
      return flattened(node, context).trim()
  }
}

const source = (text: unknown, blocks: unknown, context: Context) => {
  const fromBlocks = nodes(blocks)
    .map((each) => block(each, context))
    .filter(filled)
    .join("\n")
    .trim()
  if (fromBlocks) return fromBlocks
  return typeof text === "string" ? tokens(text, context) : ""
}

const fileLines = (files: ReadonlyArray<Node>, context: Context) =>
  files.flatMap((file) => {
    const id = field(file, "id")
    if (id && context.listed.has(id)) return []
    if (id) context.listed.add(id)
    const label = field(file, "name") || field(file, "title") || "untitled"
    const mime = field(file, "mimetype")
    return [mime ? `[file: ${label} (${mime})]` : `[file: ${label}]`]
  })

const forwarded = (attachment: Node) =>
  nodes(attachment.message_blocks).flatMap((entry) => (isNode(entry.message) ? [entry.message] : []))

const sharedBlocks = (attachment: Node) => {
  if (nodes(attachment.blocks).length > 0) return attachment.blocks
  const inner = forwarded(attachment).flatMap((message) => nodes(message.blocks))
  return inner.length > 0 ? inner : attachment.blocks
}

const attachmentFiles = (attachment: Node) => [
  ...nodes(attachment.files),
  ...forwarded(attachment).flatMap((message) => nodes(message.files)),
]

const sourceLabel = (attachment: Node) => {
  const author = field(attachment, "author_name")
  const channel = field(attachment, "channel_name")
  if (attachment.is_share === true || attachment.is_msg_unfurl === true)
    return `forwarded message${author ? ` from ${author}` : ""}${channel ? ` in #${channel}` : ""}`
  const service = field(attachment, "service_name")
  if (service) return `link via ${service}`
  return author ? `from ${author}` : ""
}

const attachmentText = (attachment: Node, context: Context) => {
  const pretext = field(attachment, "pretext")
  const title = field(attachment, "title")
  const titleLink = field(attachment, "title_link")
  const image = field(attachment, "image_url")
  const inner = [
    pretext && tokens(pretext, context),
    titleLink ? `${title || titleLink} (${titleLink})` : title,
    source(attachment.text, sharedBlocks(attachment), context),
    ...nodes(attachment.fields)
      .map((each) => `${field(each, "title")}: ${field(each, "value")}`.trim())
      .filter((line) => line !== ":"),
    image && `[image] ${image}`,
    ...fileLines(attachmentFiles(attachment), context),
    field(attachment, "footer"),
  ]
    .filter((segment) => segment.trim().length > 0)
    .join("\n")
    .trim()
  if (!inner) return ""
  const indented = inner
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")
  const label = sourceLabel(attachment)
  return label ? `↳ ${label}:\n${indented}` : indented
}

const fileReferences = (files: ReadonlyArray<Node>): ReadonlyArray<Channel.FileRef> => {
  const seen = new Set<string>()
  return files.flatMap((file) => {
    const id = field(file, "id")
    const url = field(file, "url_private_download") || field(file, "url_private")
    if (!url || (id && seen.has(id))) return []
    if (id) seen.add(id)
    return [
      {
        url,
        name: field(file, "name") || field(file, "title") || "untitled",
        mime: field(file, "mimetype") || "application/octet-stream",
        ...(typeof file.size === "number" && { size: file.size }),
      },
    ]
  })
}

export const parse = (message: Raw, botUser: string | undefined) => {
  const context: Context = { bot: botUser, listed: new Set() }
  const attachments = nodes(message.attachments)
  const primary = source(message.text, message.blocks, context)
  const extras = [
    ...attachments.map((attachment) => attachmentText(attachment, context)),
    ...fileLines(nodes(message.files), context),
  ]
    .filter(filled)
    .join("\n")
  return {
    text: [primary, extras].filter(filled).join("\n\n"),
    files: fileReferences([...nodes(message.files), ...attachments.flatMap(attachmentFiles)]),
  }
}

const userToken = /<@([A-Z0-9]+)>/gu

const channelToken = /<#([A-Z0-9]+)>/gu

export const references = (text: string) => ({
  users: [...new Set([...text.matchAll(userToken)].map((match) => match.at(1) ?? ""))].filter(filled),
  channels: [...new Set([...text.matchAll(channelToken)].map((match) => match.at(1) ?? ""))].filter(filled),
})

export const named = (text: string, users: ReadonlyMap<string, string>, channels: ReadonlyMap<string, string>) =>
  text
    .replaceAll(userToken, (_, id: string) => `@${users.get(id) ?? id}`)
    .replaceAll(channelToken, (_, id: string) => `#${channels.get(id) ?? id}`)
