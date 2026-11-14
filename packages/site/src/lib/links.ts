export const OPEN_APP_URL = `${import.meta.env.SITE}/login`

export const BILLING_URL = `${import.meta.env.SITE}/settings/billing`

export const CALENDLY_URL = "https://calendly.com/shrey-renai/30min"

export const GITHUB_URL = "https://github.com/renai-labs/ren"

export const DISCORD_URL = "https://discord.gg/TYKUU4peY"

const withSource = (url: string, source: string) => {
  const link = new URL(url)
  link.searchParams.set("utm_content", source)
  return link.href
}

export const signupHref = (source: string) => withSource(`${import.meta.env.SITE}/signup`, source)

export const demoHref = (source: string) => withSource(CALENDLY_URL, source)

export const askRenHref = (prompt: string) =>
  `${OPEN_APP_URL}?${new URLSearchParams({ redirect: `/?${new URLSearchParams({ prompt })}` })}`
