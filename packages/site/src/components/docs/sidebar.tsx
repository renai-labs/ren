import { useState } from "react"
import { useSearchContext } from "fumadocs-ui/contexts/search"
import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover"
import { useTheme } from "fumadocs-ui/provider/base"
import {
  IconArrowUpRight,
  IconBook,
  IconCalendar,
  IconCheck,
  IconCode,
  IconMoon,
  IconSearch,
  IconSelector,
  IconSun,
} from "@tabler/icons-react"
import { APP_URL, CALENDLY_URL, GITHUB_URL } from "../../lib/links.js"
import type { SectionLink } from "../../lib/docs/nav.js"
import { DocsIcon } from "./icons.js"

const SECTION_ICONS = { BookOpen: IconBook, Code: IconCode }

function SectionTile(props: { icon: SectionLink["icon"] }) {
  const Icon = SECTION_ICONS[props.icon]
  return (
    <span className="docs-section-tile">
      <Icon />
    </span>
  )
}

function SectionText(props: { section: SectionLink }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col text-start">
      <span className="truncate text-[13px] font-medium text-fd-foreground">{props.section.title}</span>
      <span className="truncate text-[12px] text-fd-muted-foreground">{props.section.description}</span>
    </span>
  )
}

function SectionSwitcher(props: { sections: SectionLink[] }) {
  const [open, setOpen] = useState(false)
  const current = props.sections.find((section) => section.current)
  if (!current) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="docs-section-trigger">
        <SectionTile icon={current.icon} />
        <SectionText section={current} />
        <IconSelector className="size-3.5 shrink-0 text-fd-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="docs-section-menu">
        {props.sections.map((section) => (
          <a key={section.href} href={section.href} className="docs-section-option" onClick={() => setOpen(false)}>
            <SectionTile icon={section.icon} />
            <SectionText section={section} />
            {section === current ? <IconCheck className="size-3.5 shrink-0 text-fd-foreground" /> : null}
          </a>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function SearchButton() {
  const search = useSearchContext()
  if (!search.enabled) return null
  return (
    <button type="button" className="docs-search-button" onClick={() => search.setOpenSearch(true)}>
      <IconSearch className="size-3.5 shrink-0" />
      <span className="flex-1 text-start">Search</span>
      <kbd className="docs-kbd">Ctrl K</kbd>
    </button>
  )
}

export function SidebarHeader(props: { sections: SectionLink[] }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionSwitcher sections={props.sections} />
      <SearchButton />
    </div>
  )
}

function AppearanceRow() {
  const theme = useTheme()
  return (
    <button
      type="button"
      className="docs-foot-row"
      onClick={() => theme.setTheme(theme.resolvedTheme === "light" ? "dark" : "light")}
    >
      <IconMoon className="docs-when-dark" />
      <IconSun className="docs-when-light" />
      <span className="flex-1 text-start">Appearance</span>
      <span className="docs-when-dark text-[12px] text-fd-muted-foreground">Dark</span>
      <span className="docs-when-light text-[12px] text-fd-muted-foreground">Light</span>
    </button>
  )
}

export function SidebarFooter() {
  return (
    <div className="docs-sidebar-foot">
      <AppearanceRow />
      <div className="flex items-center gap-1">
        <a href={`${APP_URL}/`} className="docs-foot-row flex-1">
          <IconArrowUpRight />
          <span className="flex-1">Open Ren</span>
        </a>
        <a
          href={CALENDLY_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Book a demo"
          title="Book a demo"
          className="docs-foot-icon"
        >
          <IconCalendar />
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="GitHub"
          title="GitHub"
          className="docs-foot-icon"
        >
          <DocsIcon name="Github" />
        </a>
      </div>
    </div>
  )
}
