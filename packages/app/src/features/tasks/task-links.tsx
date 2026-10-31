import type { TaskInfo } from "@ren/client"
import { IconLink } from "@tabler/icons-react"
import { Link } from "@ren/ui/link"

export function TaskLinks(props: { links: TaskInfo["links"] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Links</h2>
      {props.links.map((link) => (
        <Link
          key={link.id}
          href={link.url}
          external
          appearance="plain"
          className="flex items-center gap-2 text-sm text-ring"
        >
          <IconLink className="size-4" />
          {link.url}
        </Link>
      ))}
    </section>
  )
}
