import type { Platform } from "./platform.js"

const prefix = "ren."
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
    openExternal: (url) => {
      if (!externalProtocols.has(new URL(url).protocol)) return
      window.open(url, "_blank", "noopener,noreferrer")
    },
    notify: async (title, body) => {
      if (!("Notification" in window)) return
      const permission =
        Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
      if (permission !== "granted") return
      new Notification(title, body === undefined ? undefined : { body })
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
