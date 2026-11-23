export * as RenRpc from "./rpc.js"

import { Rpc } from "@opencode/plugin/rpc"

export const Ren = Rpc.define({ id: "ren", methods: {}, events: {} })
