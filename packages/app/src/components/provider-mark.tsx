import { cn } from "cn"

// oxlint-disable-next-line ren/no-comments -- A provider's logo: the address its inference service gives. With `letter`, a provider without a logo shows its first letter.
export function ProviderMark(props: {
  provider: string
  logo?: string | undefined
  letter?: boolean | undefined
  className?: string | undefined
}) {
  // oxlint-disable-next-line ren/no-comments -- A provider's logo from the inference service is a one-colour glyph (models.dev's are): drawn as a mask, it takes the text colour in both themes.
  if (props.logo)
    return (
      <span
        aria-hidden
        className={cn("size-4 shrink-0 bg-current mask-contain mask-center mask-no-repeat", props.className)}
        // oxlint-disable-next-line react/forbid-dom-props -- the mask is the logo's address, which the inference service gives as data
        style={{ maskImage: `url("${props.logo}")` }}
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
