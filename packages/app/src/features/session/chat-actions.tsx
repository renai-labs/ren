import { useState } from "react"
import type { Session } from "@ren/schema/session"
import type { SessionCapabilities } from "@ren/schema/session/capabilities"
import {
  IconArchive,
  IconArrowsMinimize,
  IconClock,
  IconCopy,
  IconDots,
  IconLink,
  IconRepeat,
  IconRestore,
  IconRosetteDiscountCheck,
} from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { toast } from "@ren/ui/sonner"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { ScheduleSheet } from "../../components/schedule-sheet.js"
import { useAutoApprove } from "../../lib/chat.js"
import { errorMessage } from "../../lib/errors.js"
import { Platform } from "../../platform/platform.js"

function AutoApproveItem(props: { sessionId: Session.ID }) {
  const approval = useAutoApprove(props.sessionId)
  return (
    <DropdownMenuCheckboxItem
      checked={approval.enabled}
      onCheckedChange={(enabled) =>
        void approval
          .set({ enabled })
          .catch((error: unknown) =>
            toast.error("Could not change automatic approval", { description: errorMessage(error) }),
          )
      }
    >
      <IconRosetteDiscountCheck />
      Approve every request automatically
    </DropdownMenuCheckboxItem>
  )
}

export function ChatActions(props: {
  sessionId: Session.ID
  title: string
  spaceId: string | undefined
  capabilities: SessionCapabilities.Info | undefined
  prompted: boolean
  reverted: boolean
  onUndo: () => void
  onRestore: () => void
  onCompact: () => void
  onArchive: () => Promise<unknown>
}) {
  const [archiving, setArchiving] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const spaceId = props.spaceId
  const write = Platform.usePlatform().writeClipboardText
  const copy = (text: string, copied: { readonly done: string; readonly failed: string }) =>
    void write?.(text).then(
      () => toast.success(copied.done, { description: text }),
      (error: unknown) => toast.error(copied.failed, { description: errorMessage(error) }),
    )
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Chat actions" />}
        >
          <IconDots />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuGroup>
            {props.capabilities?.revert === false ? null : (
              <>
                <DropdownMenuItem disabled={!props.prompted} onClick={props.onUndo}>
                  <IconRestore />
                  Undo last message
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!props.reverted} onClick={props.onRestore}>
                  <IconRepeat />
                  Restore undone messages
                </DropdownMenuItem>
              </>
            )}
            {props.capabilities?.compact === false ? null : (
              <DropdownMenuItem disabled={!props.prompted} onClick={props.onCompact}>
                <IconArrowsMinimize />
                Compact chat
              </DropdownMenuItem>
            )}
            {props.capabilities?.permissions === false ? null : <AutoApproveItem sessionId={props.sessionId} />}
            {write ? (
              <>
                <DropdownMenuItem
                  onClick={() =>
                    copy(props.sessionId, { done: "Chat ID copied", failed: "Could not copy the chat ID" })
                  }
                >
                  <IconCopy />
                  Copy chat ID
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => copy(window.location.href, { done: "Link copied", failed: "Could not copy the link" })}
                >
                  <IconLink />
                  Copy link
                </DropdownMenuItem>
              </>
            ) : null}
            {spaceId ? (
              <DropdownMenuItem onClick={() => setScheduling(true)}>
                <IconClock />
                Schedule a message
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setArchiving(true)}>
              <IconArchive />
              Archive chat
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {spaceId ? (
        <ScheduleSheet
          open={scheduling}
          version={0}
          schedule={undefined}
          chat={{ spaceId, sessionId: props.sessionId }}
          onClose={() => setScheduling(false)}
        />
      ) : null}
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        confirmation={{
          title: `Archive “${props.title}”?`,
          description: "It leaves your chat list. Only the API can bring it back.",
          action: "Archive",
        }}
        onConfirm={props.onArchive}
      />
    </>
  )
}
