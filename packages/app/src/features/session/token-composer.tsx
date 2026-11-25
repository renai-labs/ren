import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type Ref, type RefObject } from "react"
import { Composer, ComposerTokens, Mentions } from "@ren/chat"
import { cn } from "cn"
import {
  TokenInput,
  TokenInputEditor,
  TokenInputToken,
  type TokenInputController,
  type TokenInputValue,
} from "@ui-sdk/react/token-input"
import {
  TriggerMenu,
  TriggerMenuContent,
  TriggerMenuEmpty,
  TriggerMenuGroup,
  TriggerMenuGroupLabel,
  TriggerMenuItem,
  TriggerMenuItemIcon,
  TriggerMenuList,
  TriggerMenuStatus,
  type TriggerMenuController,
} from "@ui-sdk/react/trigger-menu"
import { IconChevronRight, IconFolder, IconTerminal2, IconApps } from "@tabler/icons-react"
import { FileIcon } from "@ren/ui/file-icon"
import { MentionLogo } from "@ren/ui/app-mention"
import { Spinner } from "@ren/ui/spinner"
import type { Suggest } from "./use-composer-suggestions.js"
import { AppIcon } from "../../components/app-icon.js"
import { AgentIcon, ChatIcon, mentionIcons, RepositoryIcon, TaskIcon } from "../../components/mention-icon.js"
import { StatusDot } from "../../components/status-dot.js"
import { statusLabel } from "../../lib/apps.js"
import { useHeld } from "../../lib/use-held.js"

type Item = Suggest["items"][number]
type Chosen = NonNullable<ReturnType<Suggest["onChoose"]>>

const categoryIcons = {
  tasks: <TaskIcon />,
  chats: <ChatIcon />,
  apps: <IconApps />,
  agents: <AgentIcon />,
  files: <IconFolder />,
  repos: <RepositoryIcon />,
}

const triggers = [
  { char: "@", type: "mention", pattern: /[^\s@]/u, maxLength: 200, filter: false as const },
  { char: "/", type: "command", boundary: "start" as const, pattern: /\S/u, filter: false as const },
]

function ItemIcon(props: { item: Item }) {
  const item = props.item
  if (item.kind === "app") return <AppIcon name={item.label} icon={item.icon} size="sm" className="size-4 rounded-sm" />
  if (item.kind === "category") return item.category ? categoryIcons[item.category] : null
  if (item.kind === "command") return <IconTerminal2 />
  if (item.kind === "repository") return <RepositoryIcon />
  if (item.kind === "folder") return <IconFolder />
  if (item.kind === "file") return <FileIcon name={item.label} />
  return mentionIcons[item.kind] ?? <AgentIcon />
}

function TokenIcon(props: { item: Mentions.Item; icon: string | null }) {
  const glyph = mentionIcons[props.item.kind]
  if (glyph) return <span className="flex size-[1em] items-center justify-center [&_svg]:size-[0.95em]">{glyph}</span>
  if (props.item.kind === "file") return <FileIcon name={props.item.label} className="size-[1em]" />
  return <MentionLogo name={props.item.label} icon={props.icon} />
}

const grouped = (items: ReadonlyArray<Item>) =>
  [...new Set(items.map((item) => item.group))].map((heading) => ({
    heading,
    items: items.filter((item) => item.group === heading),
  }))

const withChoice = (draft: Composer.Draft, chosen: Chosen | undefined) => {
  const mentioned = chosen?.mention ? Composer.withMention(draft, chosen.mention) : draft
  return chosen?.file ? Composer.withFile(mentioned, chosen.file) : mentioned
}

const valueOf = (draft: Composer.Draft, suggest: Suggest): TokenInputValue => [
  ...ComposerTokens.toValue(draft.text, suggest.tokens(draft.text)),
]

export function TokenComposer(props: {
  draft: Composer.Draft
  onDraft: (draft: Composer.Draft) => void
  suggest: Suggest
  tokens: TokenInputController
  menu: TriggerMenuController
  anchor: RefObject<HTMLElement | null>
  below: boolean
  editorRef?: Ref<HTMLDivElement | null> | undefined
  label: string
  placeholder: string
  readOnly: boolean
  className?: string | undefined
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
}) {
  const suggest = props.suggest
  const [value, setValue] = useState(() => valueOf(props.draft, suggest))
  const chosen = useRef<Chosen>(undefined)
  if (ComposerTokens.textOf(value) !== props.draft.text) setValue(valueOf(props.draft, suggest))
  const items = useHeld(suggest.items, {
    holding: suggest.searching,
    key: (list) => list.map((item) => item.value).join("\n"),
  })
  const query = (trigger: string, typed: string) => suggest.onCursor(trigger + typed, trigger.length + typed.length)
  return (
    <TokenInput
      controller={props.tokens}
      value={value}
      readOnly={props.readOnly}
      onValueChange={(next) => {
        setValue(next)
        const result = chosen.current
        chosen.current = undefined
        props.onDraft(withChoice(ComposerTokens.toDraft(props.draft, next), result))
      }}
      renderToken={(token) => {
        const item = ComposerTokens.itemOf(token)
        return (
          <TokenInputToken
            data-chip=""
            className="inline-flex items-baseline gap-1 rounded-sm text-(--link) data-selected:bg-(--link)/15"
          >
            {item ? (
              <span className="self-center">
                <TokenIcon item={item} icon={suggest.iconOf(item)} />
              </span>
            ) : null}
            {token.label}
          </TokenInputToken>
        )
      }}
    >
      <TokenInputEditor
        ref={props.editorRef}
        aria-label={props.label}
        placeholder={props.placeholder}
        dir="auto"
        onKeyDown={props.onKeyDown}
        onPaste={props.onPaste}
        className={cn(
          "w-full overflow-y-auto px-4 pt-4 pb-2 text-base leading-relaxed wrap-break-word whitespace-pre-wrap outline-none md:text-sm",
          "data-empty:before:pointer-events-none data-empty:before:absolute data-empty:before:text-muted-foreground data-empty:before:content-[attr(aria-placeholder)]",
          props.className,
        )}
      />
      <TriggerMenu
        controller={props.menu}
        triggers={triggers}
        autoHighlight
        status={suggest.searching ? "loading" : "idle"}
        onOpenChange={(open, details) => {
          if (!open) return suggest.onClose()
          if (details.trigger) query(details.trigger, props.menu.getQuery())
        }}
        onQueryChange={(typed, details) => query(details.trigger, typed)}
        onSelect={(picked, details) => {
          details.preventDefault()
          const match = details.match
          const result = suggest.onChoose(picked, match.trigger + match.query, match.trigger.length + match.query.length)
          if (!result) return
          const item = result.picked?.item
          if (item) {
            chosen.current = result
            details.insert(ComposerTokens.fromItem(item))
            return
          }
          if (result.file) {
            chosen.current = result
            details.insert("")
            return
          }
          details.insert(result.text)
          if (result.text.startsWith("@")) requestAnimationFrame(() => void props.menu.open({ trigger: "@" }))
        }}
      >
        <TriggerMenuStatus className="sr-only" />
        <TriggerMenuContent
          anchor={{ getBoundingClientRect: () => props.anchor.current?.getBoundingClientRect() ?? new DOMRect() }}
          side={props.below ? "bottom" : "top"}
          align="start"
          sideOffset={8}
          className="m-0 flex max-h-[min(18rem,var(--available-height))] w-(--anchor-width) flex-col overflow-y-auto overscroll-contain rounded-xl border-0 bg-popover p-1 text-sm text-popover-foreground shadow-overlay"
        >
          {suggest.searching ? (
            <TriggerMenuEmpty className="flex items-center gap-2 px-2.5 py-2 text-muted-foreground">
              <Spinner aria-hidden className="size-3.5" />
              Searching…
            </TriggerMenuEmpty>
          ) : null}
          <TriggerMenuList
            aria-label={suggest.label}
            className="transition-opacity duration-150 ease-out aria-busy:opacity-50 motion-reduce:transition-none"
          >
            {grouped(items).map((group) => (
              <TriggerMenuGroup key={group.heading ?? ""} className="flex flex-col">
                {group.heading ? (
                  <TriggerMenuGroupLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {group.heading}
                  </TriggerMenuGroupLabel>
                ) : null}
                {group.items.map((item) => (
                  <TriggerMenuItem
                    key={item.value}
                    value={item.value}
                    label={item.label}
                    className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg:not([class*='size-'])]:size-4"
                  >
                    <TriggerMenuItemIcon className="flex shrink-0 items-center text-muted-foreground">
                      <ItemIcon item={item} />
                    </TriggerMenuItemIcon>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-foreground">{item.label}</span>
                      {item.description ? <span className="text-muted-foreground"> {item.description}</span> : null}
                    </span>
                    {item.status ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <StatusDot status={item.status} />
                        {statusLabel[item.status]}
                      </span>
                    ) : null}
                    {item.kind === "category" || item.kind === "folder" ? (
                      <IconChevronRight className="-mr-1 text-muted-foreground" stroke={2.75} />
                    ) : null}
                  </TriggerMenuItem>
                ))}
              </TriggerMenuGroup>
            ))}
          </TriggerMenuList>
        </TriggerMenuContent>
      </TriggerMenu>
    </TokenInput>
  )
}
