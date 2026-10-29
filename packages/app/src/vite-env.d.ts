/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REN_API_URL?: string
  readonly VITE_REN_VERSION?: string
  readonly VITE_POSTHOG_KEY?: string
  readonly VITE_POSTHOG_HOST?: string
  readonly VITE_POSTHOG_UI_HOST?: string
}
