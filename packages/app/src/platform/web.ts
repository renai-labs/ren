import type { Platform } from "./platform.js"

const prefix = "ren."
const externalProtocols = new Set(["http:", "https:", "mailto:"])

export function createWebPlatform(): Platform.Info {
  return {
    platform: "web",
    version: import.meta.env.VITE_REN_VERSION ?? "dev",
    serverUrl: window.location.origin,
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
      new Notification(title, { body })
    },
    writeClipboardText: (text) => navigator.clipboard.writeText(text),
  }
}
