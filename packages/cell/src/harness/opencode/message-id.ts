export * as OpenCodeMessageId from "./message-id.js"

import { SessionMessage } from "@opencode/schema/session-message"

export const create = () => SessionMessage.ID.create()
