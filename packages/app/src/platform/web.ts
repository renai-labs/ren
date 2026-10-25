import { Option, Result, Schema } from "effect"
import { DraftStore } from "./draft-store.js"
import type { Platform } from "./platform.js"

const prefix = "ren."
const draftPrefix = "ren.draft."
const externalProtocols = new Set(["http:", "https:", "mailto:"])

const decodeShared = Schema.decodeUnknownOption(
  Schema.Struct({ key: Schema.String, value: Schema.UndefinedOr(Schema.String) }),
)

export function createWebPlatform(large?: DraftStore.Large): Platform.Info {
  const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("ren-drafts")
  return {
    platform: "web",
    version: import.meta.env.VITE_REN_VERSION ?? "dev",
    serverUrl: import.meta.env.VITE_REN_API_URL ?? window.location.origin,
    appUrl: new URL(import.meta.env.BASE_URL, window.location.origin).href.replace(/\/$/, ""),
    authorizationQuery: new URLSearchParams(window.location.search).has("sig")
      ? window.location.search.slice(1)
      : undefined,
    fetch: Object.assign(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        globalThis.fetch(input, { ...init, credentials: "include" }),
      globalThis.fetch,
    ),
    storage: {
      get: (key) => localStorage.getItem(prefix + key) ?? undefined,
      set: (key, value) => localStorage.setItem(prefix + key, value),
      remove: (key) => localStorage.removeItem(prefix + key),
    },
    drafts: DraftStore.make({
      storage: Result.getOrUndefined(Result.try(() => window.localStorage)),
      prefix: draftPrefix,
      large,
      watch: (handler) => {
        const changed = (event: StorageEvent) => handler(event.key)
        window.addEventListener("storage", changed)
        return () => window.removeEventListener("storage", changed)
      },
      share: channel && {
        post: (message) => channel.postMessage(message),
        listen: (handler) => {
          const received = (event: MessageEvent) => Option.map(decodeShared(event.data), handler)
          channel.addEventListener("message", received)
          return () => channel.removeEventListener("message", received)
        },
      },
    }),
    openExternal: (url) => {
      if (!externalProtocols.has(new URL(url).protocol)) return
      window.open(url, "_blank", "noopener,noreferrer")
    },
    redirect: (url) => {
      if (!externalProtocols.has(new URL(url).protocol)) return
      window.location.assign(url)
    },
    notify: async (title, body) => {
      if (!("Notification" in window) || Notification.permission !== "granted") return
      if (document.visibilityState === "visible" && document.hasFocus()) return
      const notification = new Notification(title, body === undefined ? undefined : { body })
      notification.addEventListener("click", () => {
        window.focus()
        notification.close()
      })
    },
    requestNotifications: async () => {
      if (!("Notification" in window)) return false
      if (Notification.permission !== "default") return Notification.permission === "granted"
      return (await Notification.requestPermission().catch(() => "denied")) === "granted"
    },
    writeClipboardText: (text) => navigator.clipboard.writeText(text),
    onLifecycle: (listener) => {
      const visibility = () => {
        if (document.visibilityState === "visible") listener("foreground")
      }
      const pageshow = (event: PageTransitionEvent) => {
        if (event.persisted) listener("foreground")
      }
      const online = () => listener("online")
      document.addEventListener("visibilitychange", visibility)
      window.addEventListener("pageshow", pageshow)
      window.addEventListener("online", online)
      return () => {
        document.removeEventListener("visibilitychange", visibility)
        window.removeEventListener("pageshow", pageshow)
        window.removeEventListener("online", online)
      }
    },
  }
}
