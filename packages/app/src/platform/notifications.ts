export * as Notifications from "./notifications.js"

import { Option, Schema } from "effect"
import type { Platform } from "./platform.js"

const decodeClaims = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))

const focusLock = "ren:notification-focus"
const claimsKey = "ren.notification-claims"
const maxClaims = 500

const focused = () => document.visibilityState === "visible" && document.hasFocus()

const claim = (id: string) => {
  const events = Option.getOrElse(decodeClaims(localStorage.getItem(claimsKey)), (): ReadonlyArray<string> => [])
  if (events.includes(id)) return false
  localStorage.setItem(claimsKey, JSON.stringify([...events, id].slice(-maxClaims)))
  return true
}

export function make() {
  const locks = navigator.locks as LockManager | undefined
  const state: { release: (() => void) | undefined; pending: boolean } = { release: undefined, pending: false }

  const sync = () => {
    if (!locks) return
    if (!focused()) return state.release?.()
    if (state.release || state.pending) return
    state.pending = true
    locks
      .request(
        focusLock,
        { mode: "shared" },
        () =>
          new Promise<void>((resolve) => {
            state.pending = false
            if (!focused()) return resolve()
            state.release = () => {
              state.release = undefined
              resolve()
            }
          }),
      )
      .catch(() => {
        state.pending = false
      })
  }
  window.addEventListener("focus", sync)
  window.addEventListener("blur", sync)
  document.addEventListener("visibilitychange", sync)
  sync()

  const show = (title: string, body: string, options: Platform.NotifyOptions) => {
    if (options.active && !options.active()) return
    const notification = new Notification(title, { body, silent: options.silent, tag: options.id })
    notification.addEventListener("click", () => {
      window.focus()
      notification.close()
      options.onClick()
    })
  }

  return {
    permission: () => ("Notification" in window ? Notification.permission : ("unsupported" as const)),
    notify: async (title: string, body: string, options: Platform.NotifyOptions) => {
      if (!("Notification" in window) || Notification.permission !== "granted" || focused()) return
      if (!locks) {
        if (claim(options.id)) show(title, body, options)
        return
      }
      await locks.request(`ren:notification:${options.id}`, async () => {
        if (!claim(options.id)) return
        await locks.request(focusLock, { mode: "exclusive", ifAvailable: true }, (lock) => {
          if (lock) show(title, body, options)
        })
      })
    },
  }
}
