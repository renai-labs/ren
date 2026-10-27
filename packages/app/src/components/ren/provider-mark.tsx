import { cn } from "@/lib/utils"

const logos: Record<string, string> = {
  Anthropic: `${import.meta.env.BASE_URL}icons/claude.png`,
  OpenAI: `${import.meta.env.BASE_URL}icons/chatgpt.png`,
}

export function ProviderMark(props: { provider: string; className?: string | undefined }) {
  const logo = logos[props.provider]
  if (!logo) return null
  return (
    <img
      src={logo}
      alt=""
      aria-hidden
      draggable={false}
      className={cn("size-4 shrink-0 rounded-sm object-cover", props.className)}
    />
  )
}
