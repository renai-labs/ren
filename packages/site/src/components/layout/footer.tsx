import { SeparatorLine } from "../effects/separator-line.js"
import { GithubIcon } from "../ui/github-icon.js"
import { CALENDLY_URL, DISCORD_URL, GITHUB_URL } from "../../lib/links.js"

const FOOTER_LINKS = {
  product: [{ label: "Pricing", href: "/pricing/" }],
  company: [
    { label: "Why Ren", href: "/why/" },
    { label: "Contact", href: "mailto:shrey@renai.build" },
    { label: "Book a Demo", href: CALENDLY_URL },
  ],
  resources: [
    { label: "Docs", href: "/docs/" },
    { label: "Community", href: DISCORD_URL },
  ],
  legal: [
    { label: "Privacy", href: "/privacy/" },
    { label: "Terms", href: "/terms/" },
  ],
} satisfies Record<string, { label: string; href: string }[]>

const SOCIAL_LINKS = [
  {
    label: "X",
    href: "https://x.com/renaibuild",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/ren-ai-build",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    label: "GitHub",
    href: GITHUB_URL,
    icon: <GithubIcon />,
  },
  {
    label: "Discord",
    href: DISCORD_URL,
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
        <path d="M19.54 4.39A16.9 16.9 0 0 0 15.35 3l-.51 1.04a15.3 15.3 0 0 0-5.68 0L8.65 3a16.9 16.9 0 0 0-4.19 1.39C1.8 8.6 1.08 12.71 1.44 16.76a16.9 16.9 0 0 0 5.15 2.61l1.25-1.67a10.4 10.4 0 0 1-1.97-.95l.48-.37c3.8 1.78 7.92 1.78 11.68 0l.49.37c-.63.37-1.29.69-1.98.95l1.25 1.67a16.9 16.9 0 0 0 5.15-2.61c.42-4.7-.72-8.77-3.4-12.37ZM8.4 14.77c-1.14 0-2.08-1.05-2.08-2.34s.92-2.34 2.08-2.34 2.1 1.05 2.08 2.34c0 1.29-.92 2.34-2.08 2.34Zm7.2 0c-1.14 0-2.08-1.05-2.08-2.34s.92-2.34 2.08-2.34 2.1 1.05 2.08 2.34c0 1.29-.92 2.34-2.08 2.34Z" />
      </svg>
    ),
  },
]

const YEAR = new Date().getFullYear()

export function Footer() {
  return (
    <footer className="w-full bg-site-bg">
      <SeparatorLine />
      <div className="mx-auto max-w-(--page-wide-max) px-(--page-inset) py-16">
        <div className="mb-16 grid grid-cols-2 gap-8 md:grid-cols-5">
          <div className="col-span-2 md:col-span-1">
            <div className="mb-4 flex items-center gap-2">
              <img src="/ren_logo_dark.svg" alt="Ren" width={28} height={28} />
              <span className="text-[15px] font-semibold text-foreground">Ren</span>
            </div>
          </div>

          {Object.entries(FOOTER_LINKS).map(([category, links]) => (
            <div key={category}>
              <h3 className="mb-4 text-caption font-semibold text-secondary-foreground capitalize">{category}</h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="inline-flex items-center gap-2 text-caption text-muted-foreground transition-colors-quick hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <SeparatorLine />
        <div className="flex flex-col items-center justify-between gap-4 pt-8 sm:flex-row">
          <span className="text-micro text-muted-foreground">&copy; {YEAR} Ren AI</span>
          <div className="flex items-center gap-4">
            {SOCIAL_LINKS.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                className="text-muted-foreground transition-colors-quick hover:text-foreground"
              >
                {social.icon}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
