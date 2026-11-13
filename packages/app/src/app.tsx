import { Toaster } from "@ren/ui/sonner"
import { TooltipProvider } from "@ren/ui/tooltip"
import { LoadingProvider } from "@ren/ui/loading"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { useLayoutEffect, type ReactNode } from "react"
import { Theme } from "./components/theme.js"
import { AppearancePreferences } from "./lib/appearance-preferences.js"
import { ChatPreferences } from "./lib/chat-preferences.js"
import { Preference } from "./lib/preference.js"
import type { Runtime } from "./lib/runtime.js"
import { Platform } from "./platform/platform.js"

export function App(props: { runtime: ReturnType<typeof Runtime.make> }) {
  return (
    <Platform.Provider value={props.runtime.context.platform}>
      <ThemeProvider>
        <TooltipProvider>
          <QueryClientProvider client={props.runtime.context.queryClient}>
            <LoadingProvider>
              <RouterProvider router={props.runtime.router} />
            </LoadingProvider>
          </QueryClientProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </Platform.Provider>
  )
}

function ThemeProvider(props: { children: ReactNode }) {
  const theme = Preference.usePreference(AppearancePreferences.theme)
  const timelineWidth = Preference.usePreference(ChatPreferences.timelineWidth)
  const uiFont = Preference.usePreference(AppearancePreferences.uiFont)
  const uiSize = Preference.usePreference(AppearancePreferences.uiSize)
  const codeFont = Preference.usePreference(AppearancePreferences.codeFont)
  const codeSize = Preference.usePreference(AppearancePreferences.codeSize)
  const setPreference = Preference.useSetPreference()
  useLayoutEffect(() => {
    AppearancePreferences.apply(document.documentElement, { uiFont, uiSize, codeFont, codeSize })
  }, [uiFont, uiSize, codeFont, codeSize])
  useLayoutEffect(() => {
    document.documentElement.dataset.timelineWidth = timelineWidth
  }, [timelineWidth])
  return (
    <Theme.Provider preference={theme} onPreferenceChange={(next) => setPreference(AppearancePreferences.theme, next)}>
      {props.children}
    </Theme.Provider>
  )
}
