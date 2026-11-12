import { IconExternalLink, IconInfoCircle } from "@tabler/icons-react"
import { Link } from "@ren/ui/link"

export function ChatGptGuide() {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <IconInfoCircle className="mt-0.5 size-4 shrink-0" />
      <span>
        Before you connect, turn on <span className="text-foreground">Enable device code authorization for Codex</span>{" "}
        in your{" "}
        <Link
          href="https://chatgpt.com/#settings/Security"
          external
          className="inline-flex items-center gap-1 font-normal text-foreground underline underline-offset-2"
        >
          ChatGPT security settings
          <IconExternalLink className="size-3" />
        </Link>
        .
      </span>
    </p>
  )
}
