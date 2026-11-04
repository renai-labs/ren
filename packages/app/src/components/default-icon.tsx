import {
  IconApps,
  IconAtom,
  IconBook,
  IconBrowser,
  IconCalendarEvent,
  IconChartBar,
  IconChartLine,
  IconCode,
  IconCpu,
  IconCreditCard,
  IconDatabase,
  IconFolder,
  IconLanguage,
  IconLifebuoy,
  IconListCheck,
  IconMail,
  IconMap,
  IconMessageCircle,
  IconMicrophone,
  IconNews,
  IconPalette,
  IconPlug,
  IconShieldLock,
  IconSparkles,
  IconSun,
  IconTestPipe,
  IconUsers,
  IconVideo,
  IconWorldSearch,
  type Icon,
} from "@tabler/icons-react"
import { cn } from "cn"

const blue = "bg-chart-1"
const green = "bg-chart-2"
const amber = "bg-chart-3"
const red = "bg-chart-4"

const topics: ReadonlyArray<readonly [RegExp, Icon, string]> = [
  [/\b(?:e-?mail|inbox|gmail|outlook|smtp|newsletter)/u, IconMail, red],
  [/\b(?:calendar|meeting|event|booking|appointment)/u, IconCalendarEvent, red],
  [/\b(?:tasks?|todos?|issues?|tickets?|projects?|kanban|linear|jira|asana)\b/u, IconListCheck, red],
  [/\b(?:support|helpdesk|zendesk|intercom)/u, IconLifebuoy, red],
  [/\b(?:design|figma|canva|image|photo|draw|illustrat|logo)/u, IconPalette, red],
  [/\b(?:news|feed|rss|headline)/u, IconNews, blue],
  [/\b(?:search|crawl|scrap|web|exa|firecrawl)/u, IconWorldSearch, blue],
  [/\b(?:browser|playwright|puppeteer|automation)/u, IconBrowser, blue],
  [/\b(?:chat|message|slack|discord|whatsapp|telegram|sms)/u, IconMessageCircle, blue],
  [/\b(?:ai|llm|models?|gpt|openai|anthropic|claude|prompt|embedding)\b/u, IconCpu, blue],
  [/\b(?:translat|language|i18n)/u, IconLanguage, blue],
  [/\b(?:docs?|documentation|wiki|notion|notes?|knowledge|readme|confluence)\b/u, IconBook, blue],
  [/\b(?:database|sql|postgres|mysql|mongo|supabase|redis|queries|query)/u, IconDatabase, green],
  [/\b(?:tests?|testing|qa|quality|lint)\b/u, IconTestPipe, green],
  [/\b(?:code|github|gitlab|git|repo|deploy|build|vercel|cloudflare|devops|ci)\b/u, IconCode, green],
  [/\b(?:research|papers?|arxiv|science|scholar)/u, IconAtom, green],
  [/\b(?:maps?|location|geo|travel|places?)\b/u, IconMap, green],
  [/\b(?:weather|forecast)/u, IconSun, amber],
  [/\b(?:stocks?|market|finance|trading|portfolio|earnings)/u, IconChartLine, amber],
  [/\b(?:pay|payment|billing|invoice|stripe|checkout|subscription)/u, IconCreditCard, amber],
  [/\b(?:analytics|metrics?|dashboard|charts?|stats|insight|posthog|datadog|sentry)/u, IconChartBar, amber],
  [/\b(?:files?|drive|storage|dropbox|upload|pdf|folder)/u, IconFolder, amber],
  [/\b(?:crm|sales|leads?|customers?|hubspot|salesforce|apollo)/u, IconUsers, amber],
  [/\b(?:security|auth|password|secrets?|vault|1password)/u, IconShieldLock, amber],
  [/\b(?:video|youtube|zoom|loom|stream)/u, IconVideo, red],
  [/\b(?:audio|music|podcast|voice|speech|transcri)/u, IconMicrophone, red],
]

const kinds = { app: IconApps, skill: IconSparkles, mcp: IconPlug } as const

const tiles = [blue, green, amber, red] as const

const hash = (text: string) =>
  Array.from({ length: text.length }, (_, index) => text.charCodeAt(index)).reduce(
    (sum, code) => (sum * 31 + code) >>> 0,
    7,
  )

export function defaultIcon(kind: keyof typeof kinds, name: string, description?: string | null) {
  const text = `${name} ${description ?? ""}`.toLowerCase().replaceAll(/[-_]/gu, " ")
  const topic = topics.find((each) => each[0].test(text))
  return {
    icon: topic?.[1] ?? kinds[kind],
    tile: topic?.[2] ?? tiles[hash(name) % tiles.length] ?? blue,
  }
}

export function DefaultIcon(props: {
  kind: keyof typeof kinds
  name: string
  description?: string | null | undefined
  tile?: string | undefined
  className?: string | undefined
}) {
  const fallback = props.tile
    ? { icon: kinds[props.kind], tile: props.tile }
    : defaultIcon(props.kind, props.name, props.description)
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg text-white",
        fallback.tile,
        props.className,
      )}
    >
      <fallback.icon className="size-1/2" stroke={1.75} />
    </span>
  )
}
