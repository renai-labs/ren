export * as Translate from "./translate.js"

import type { Agent } from "@opencode/schema/agent"
import type { Command } from "@opencode/schema/command"
import type { FileSystem } from "@opencode/schema/filesystem"
import type { Form as OpenCodeForm } from "@opencode/schema/form"
import type { Permission as OpenCodePermission } from "@opencode/schema/permission"
import type { Session as OpenCodeSession } from "@opencode/schema/session"
import type { SessionInbox as OpenCodeInbox } from "@opencode/schema/session-inbox"
import type { SessionMessage as OpenCodeMessage } from "@opencode/schema/session-message"
import type { Revert } from "@opencode/schema/session-revert"
import type { Shell as OpenCodeShell } from "@opencode/schema/shell"
import type { Skill } from "@opencode/schema/skill"
import type { Vcs } from "@opencode/schema/vcs"
import { ChannelOrigin } from "@ren/schema/channel-origin"
import { Form } from "@ren/schema/form"
import { Permission } from "@ren/schema/permission"
import { ScheduleOrigin } from "@ren/schema/schedule-origin"
import { SessionEvent } from "@ren/schema/session/event"
import type { SessionCapabilities } from "@ren/schema/session/capabilities"
import { SessionCatalog } from "@ren/schema/session/catalog"
import { SessionInbox } from "@ren/schema/session/inbox"
import { SessionInfo } from "@ren/schema/session/info"
import { SessionMessage } from "@ren/schema/session/message"
import { SessionVcs } from "@ren/schema/session/vcs"
import { Shell } from "@ren/schema/shell"
import { TaskAssignment } from "@ren/schema/task-assignment"
import { Option, Predicate, pipe, Schema, Struct } from "effect"

const UserID = Schema.Struct({ metadata: Schema.Struct({ userID: Schema.String }) })
const decodeUserID = Schema.decodeUnknownOption(UserID)

const FromChannel = Schema.Struct({ metadata: Schema.Struct({ channel: ChannelOrigin.Info }) })
const decodeChannel = Schema.decodeUnknownOption(FromChannel)

const FromSchedule = Schema.Struct({ metadata: Schema.Struct({ schedule: ScheduleOrigin.Info }) })
const decodeSchedule = Schema.decodeUnknownOption(FromSchedule)

const FromTask = Schema.Struct({ metadata: Schema.Struct({ task: TaskAssignment.Info }) })
const decodeTask = Schema.decodeUnknownOption(FromTask)

const UserText = Schema.Struct({ type: Schema.Literal("user"), text: Schema.String })
const decodeUserText = Schema.decodeUnknownOption(UserText)

const taskOf = (value: unknown) =>
  Option.orElse(
    Option.map(decodeTask(value), (decoded) => decoded.metadata.task),
    () => Option.flatMap(decodeUserText(value), (decoded) => TaskAssignment.parse(decoded.text)),
  )

const WithUploads = Schema.Struct({ metadata: Schema.Struct({ files: Schema.Array(SessionMessage.DriveFile) }) })
const decodeUploads = Schema.decodeUnknownOption(WithUploads)

const isNamedList = Schema.is(Schema.Array(Schema.Struct({ name: Schema.optionalKey(Schema.String) })))

const withoutUploads = (files: unknown, uploads: ReadonlyArray<SessionMessage.DriveFile>) =>
  isNamedList(files) ? files.filter((file) => !uploads.some((upload) => upload.name === file.name)) : files

const withMetadata = (value: unknown): unknown => {
  if (!Predicate.isObject(value)) return value
  const sender = decodeUserID(value)
  const channel = decodeChannel(value)
  const schedule = decodeSchedule(value)
  const uploads = decodeUploads(value)
  const task = taskOf(value)
  return {
    ...value,
    ...(Option.isSome(sender) && { sender: { userId: sender.value.metadata.userID } }),
    ...(Option.isSome(channel) && { channel: channel.value.metadata.channel }),
    ...(Option.isSome(schedule) && { schedule: schedule.value.metadata.schedule }),
    ...(Option.isSome(task) && { task: task.value }),
    ...(Option.isSome(uploads) && {
      uploads: uploads.value.metadata.files,
      ...(Predicate.hasProperty(value, "files") && {
        files: withoutUploads(value.files, uploads.value.metadata.files),
      }),
    }),
  }
}

const Kind = Schema.Struct({ metadata: Schema.Struct({ kind: Schema.String }) })
const decodeKind = Schema.decodeUnknownOption(Kind)

const withKind = (value: unknown): unknown => {
  if (!Predicate.isObject(value)) return value
  return Option.match(decodeKind(value), {
    onNone: () => value,
    onSome: (found) => ({ ...value, kind: found.metadata.kind }),
  })
}

const Owner = Schema.Struct({ metadata: Schema.Struct({ sessionID: Schema.String }) })
const decodeOwner = Schema.decodeUnknownOption(Owner)

const withOwner = (value: unknown): unknown => {
  if (!Predicate.isObject(value)) return value
  return Option.match(decodeOwner(value), {
    onNone: () => value,
    onSome: (found) => ({ ...value, sessionID: found.metadata.sessionID }),
  })
}

const nested = (value: unknown, key: string, update: (inner: unknown) => unknown): unknown =>
  Predicate.hasProperty(value, key) ? { ...value, [key]: update(value[key]) } : value

const decodeEvent = Schema.decodeUnknownOption(SessionEvent.Event)
const readMessage = Schema.decodeUnknownOption(Schema.toType(SessionMessage.Info))
const readInbox = Schema.decodeUnknownOption(Schema.toType(SessionInbox.Info))
const readCompaction = Schema.decodeUnknownOption(Schema.toType(SessionInbox.Compaction))
const readPermission = Schema.decodeUnknownOption(Schema.toType(Permission.Request))
const readForm = Schema.decodeUnknownOption(Schema.toType(Form.Info))
const readSession = Schema.decodeUnknownOption(Schema.toType(SessionInfo.Info.mapFields(Struct.omit(["capabilities"]))))
const readRevert = Schema.decodeUnknownOption(Schema.toType(SessionInfo.Revert))
const readShell = Schema.decodeUnknownOption(Schema.toType(Shell.Info))
const readAgent = Schema.decodeUnknownOption(Schema.toType(SessionCatalog.Agent))
const readSkill = Schema.decodeUnknownOption(Schema.toType(SessionCatalog.Skill))
const readCommand = Schema.decodeUnknownOption(Schema.toType(SessionCatalog.Command))
const readFile = Schema.decodeUnknownOption(Schema.toType(SessionCatalog.File))
const readVcs = Schema.decodeUnknownOption(Schema.toType(SessionVcs.Info))

const Typed = Schema.Struct({ type: Schema.String })
const decodeTyped = Schema.decodeUnknownOption(Typed)

export const isAllowed = (raw: unknown) =>
  Option.match(decodeTyped(raw), { onNone: () => false, onSome: (typed) => SessionEvent.types.has(typed.type) })

const decodeConnected = Schema.decodeUnknownOption(
  Schema.Struct({ id: Schema.String, type: Schema.Literal("server.connected") }),
)

export const frame = (
  raw: unknown,
  created: number,
): Option.Option<SessionEvent.Event | typeof SessionEvent.Connected.Type> =>
  Option.match(decodeConnected(raw), {
    onNone: () => event(raw),
    onSome: (connected) => Option.some({ id: connected.id, created, type: connected.type, data: {} }),
  })

export const event = (raw: unknown): Option.Option<SessionEvent.Event> => {
  if (!isAllowed(raw)) return Option.none()
  return decodeEvent(
    nested(raw, "data", (data) =>
      pipe(
        data,
        (value) => nested(value, "item", (item) => nested(item, "payload", withMetadata)),
        (value) => nested(value, "form", withKind),
        (value) => nested(value, "info", withOwner),
      ),
    ),
  )
}

export const message = (info: OpenCodeMessage.Info) => readMessage(withMetadata(info))

export const inbox = (info: OpenCodeInbox.Info) => readInbox(nested(info, "payload", withMetadata))

export const compaction = (info: OpenCodeInbox.Compaction) => readCompaction(info)

export const permission = (request: OpenCodePermission.Request) => readPermission(request)

export const form = (info: OpenCodeForm.Info) => readForm(withKind(info))

export const shell = (info: OpenCodeShell.Info) => readShell(withOwner(info))

export const session = (info: OpenCodeSession.Info, capabilities: SessionCapabilities.Info) =>
  Option.map(readSession(info), (read): SessionInfo.Info => ({ ...read, capabilities }))

export const revert = (staged: Revert) => readRevert(staged)

export const agent = (info: Agent.Info) => readAgent(info)

export const skill = (info: Skill.Info) => readSkill(info)

export const command = (info: Command.Info) => readCommand(info)

export const file = (entry: FileSystem.Entry) => readFile(entry)

export const vcs = (info: Vcs.Info) => readVcs(info)
