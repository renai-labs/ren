import { useMutation } from "@tanstack/react-query"
import { IconBan, IconCopy } from "@tabler/icons-react"
import type { OrganizationInviteLinkInfo } from "@ren/client"
import { toast } from "@ren/ui/sonner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { formatShortDate } from "@ren/ui/time"
import { RowMenu } from "../../components/row-menu.js"
import { TableCard, TableEmpty } from "../../components/page.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"

export function OrganizationInviteLinksTable(props: {
  links: ReadonlyArray<OrganizationInviteLinkInfo>
  empty: string
}) {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const revoke = useMutation(api["organization-invite-link"].revoke.mutationOptions())
  const copy = (link: OrganizationInviteLinkInfo) =>
    platform.writeClipboardText?.(`${platform.appUrl}/join/${link.token}`).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn’t copy the link"),
    )
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Link</TableHead>
            <TableHead>Spaces</TableHead>
            <TableHead>Made by</TableHead>
            <TableHead>Used</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.links.length === 0 ? <TableEmpty columns={6}>{props.empty}</TableEmpty> : null}
          {props.links.map((link) => (
            <TableRow key={link.id}>
              <TableCell className="font-mono text-xs">…/join/{link.token.slice(0, 10)}…</TableCell>
              <TableCell className="max-w-56 truncate text-muted-foreground">
                {link.spaces.map((space) => space.name).join(", ")}
              </TableCell>
              <TableCell className="text-muted-foreground">{link.createdBy.name}</TableCell>
              <TableCell className="text-muted-foreground tabular-nums">{link.uses}</TableCell>
              <TableCell className="text-muted-foreground tabular-nums">{formatShortDate(link.expiresAt)}</TableCell>
              <TableCell>
                <RowMenu
                  label="Link actions"
                  items={[
                    { label: "Copy", icon: IconCopy, onSelect: () => copy(link) },
                    {
                      label: "Revoke",
                      icon: IconBan,
                      onSelect: () =>
                        revoke.mutateAsync(
                          { id: link.id },
                          {
                            onSuccess: () => toast.success("Link revoked"),
                            onError: (error) =>
                              toast.error("Couldn’t revoke the link", { description: errorMessage(error) }),
                          },
                        ),
                      confirm: {
                        title: "Revoke link?",
                        description: "The link stops working. People who already joined stay.",
                        action: "Revoke",
                      },
                    },
                  ]}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}
