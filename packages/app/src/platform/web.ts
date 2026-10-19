import { Result } from "effect"
import { DraftStore } from "./draft-store.js"
import type { Platform } from "./platform.js"

const prefix = "ren."
const draftPrefix = "ren.draft."
const externalProtocols = new Set(["http:", "https:", "mailto:"])

export function createWebPlatform(): Platform.Info {
  return {
    platform: "web",
    version: import.meta.env.VITE_REN_VERSION ?? "dev",
    serverUrl: import.meta.env.VITE_REN_API_URL ?? window.location.origin,
    appUrl: new URL(import.meta.env.BASE_URL, window.location.origin).href.replace(/\/$/, ""),
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
      watch: (handler) => {
        const changed = (event: StorageEvent) => handler(event.key)
        window.addEventListener("storage", changed)
        return () => window.removeEventListener("storage", changed)
      },
    }),
    openExternal: (url) => {
      if (!externalProtocols.has(new URL(url).protocol)) return
      window.open(url, "_blank", "noopener,noreferrer")
    },
    notify: async (title, body) => {
      if (!("Notification" in window)) return
      if (document.visibilityState === "visible" && document.hasFocus()) return
      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission().catch(() => "denied" as const)
          : Notification.permission
      if (permission !== "granted") return
      const notification = new Notification(title, body === undefined ? undefined : { body })
      notification.addEventListener("click", () => {
        window.focus()
        notification.close()
      })
    },
    writeClipboardText: (text) => navigator.clipboard.writeText(text),
    onLifecycle: (listener) => {
      const visibility = () => {
        if (document.visibilityState === "visible") listener("foreground")
      }
      const pageshow = () => listener("foreground")
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
