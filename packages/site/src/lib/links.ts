const APP_URL = `${import.meta.env.SITE}/app`

export const BILLING_URL = `${APP_URL}/settings/admin/billing`

export const CALENDLY_URL = "https://calendly.com/shrey-renai/30min"

export const GITHUB_URL = "https://github.com/renai-labs/ren"

export const DISCORD_URL = "https://discord.gg/TYKUU4peY"

const withSource = (url: string, source: string) => {
  const link = new URL(url)
  link.searchParams.set("utm_content", source)
  return link.href
}

export const signupHref = (source: string) => withSource(`${APP_URL}/signup`, source)

export const demoHref = (source: string) => withSource(CALENDLY_URL, source)
