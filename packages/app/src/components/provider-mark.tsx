import { cn } from "cn"

const logos: Record<string, string> = {
  Anthropic: `${import.meta.env.BASE_URL}icons/claude.png`,
  OpenAI: `${import.meta.env.BASE_URL}icons/chatgpt.png`,
}

// oxlint-disable-next-line ren/no-comments -- A provider's logo: the address its model gateway gives, else a known one by name. With `letter`, a provider without a logo shows its first letter.
export function ProviderMark(props: {
  provider: string
  logo?: string | undefined
  letter?: boolean | undefined
  className?: string | undefined
}) {
  const logo = props.logo ?? logos[props.provider]
  // oxlint-disable-next-line ren/no-comments -- A gateway's logo is a one-colour glyph (models.dev's are): drawn as a mask, it takes the text colour in both themes.
  if (props.logo)
    return (
      <span
        aria-hidden
        className={cn(
          "size-4 shrink-0 bg-current mask-contain mask-center mask-no-repeat",
          props.className,
        )}
        // oxlint-disable-next-line react/forbid-dom-props -- the mask is the logo's address, which the gateway gives as data
        style={{ maskImage: `url("${props.logo}")` }}
      />
    )
  if (logo)
    return (
      <img
        src={logo}
        alt=""
        aria-hidden
        draggable={false}
        className={cn("size-4 shrink-0 rounded-sm object-cover", props.className)}
      />
    )
  if (!props.letter) return null
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-xs font-medium uppercase",
        props.className,
      )}
    >
      {props.provider.charAt(0)}
    </span>
  )
}
