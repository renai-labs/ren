import { IconMenu2, IconX } from "@tabler/icons-react"
import { useState } from "react"
import { GITHUB_URL, signupHref } from "../../lib/links.js"
import { buttonClass } from "../ui/button.js"
import { GithubIcon } from "../ui/github-icon.js"

const SIGNUP_CLASS = "border-transparent hover:bg-white hover:opacity-90 focus-visible:outline-solid"

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <header className="fixed inset-x-0 top-0 z-(--layer-header) border-b border-(--header-border) bg-(--header-bg) backdrop-blur-(--header-blur)">
      <div className="mx-auto flex h-(--header-height) w-full max-w-(--page-wide-max) items-center justify-between px-(--page-inset)">
        <a href="/" className="flex shrink-0 items-center gap-2.5">
          <img src="/ren_logo_dark.svg" alt="Ren" width={24} height={24} className="size-6" />
          <span className="text-xl leading-none font-semibold text-foreground">Ren</span>
        </a>

        <div className="hidden items-center gap-3 md:flex">
          <nav className="flex items-center">
            <a
              href="/docs/"
              className="flex h-8 items-center rounded-full px-3 text-[13px] text-muted-foreground transition-colors-quick hover:bg-tint-5 hover:text-foreground"
            >
              Docs
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors-quick hover:bg-tint-5 hover:text-foreground"
            >
              <GithubIcon />
            </a>
          </nav>
          <a
            href={signupHref("navbar")}
            className={buttonClass({ variant: "primary", size: "sm", className: SIGNUP_CLASS })}
          >
            Sign up
          </a>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <a
            href={signupHref("navbar-mobile")}
            className={buttonClass({ variant: "primary", size: "sm", className: SIGNUP_CLASS })}
          >
            Sign up
          </a>
          <button
            type="button"
            className="p-2 text-muted-foreground transition-colors-quick hover:text-foreground"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMenuOpen ? <IconX className="size-5" /> : <IconMenu2 className="size-5" />}
          </button>
        </div>
      </div>

      {isMenuOpen ? (
        <div className="border-hairline border-t border-(--header-border) bg-(--header-bg) backdrop-blur-(--header-blur) md:hidden">
          <div className="space-y-1 px-6 py-4">
            <a
              href="/docs/"
              className="flex items-center rounded-md p-3 text-body-sm font-medium text-muted-foreground transition-colors-quick hover:bg-tint-2 hover:text-foreground"
              onClick={() => setIsMenuOpen(false)}
            >
              Docs
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md p-3 text-body-sm font-medium text-muted-foreground transition-colors-quick hover:bg-tint-2 hover:text-foreground"
            >
              <GithubIcon />
              GitHub
            </a>
          </div>
        </div>
      ) : null}
    </header>
  )
}
