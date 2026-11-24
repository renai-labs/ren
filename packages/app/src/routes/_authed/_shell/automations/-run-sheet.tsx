import { SessionSheet } from "../../../../components/session-sheet.js"
import { SessionThread } from "../../../../features/session/chat-page.js"

// oxlint-disable-next-line ren/no-comments -- The chat of an automation's run, beside the list or the editor it was opened from; the route keeps it in its session search parameter.
export function RunSheet(props: { session: string | undefined; onClose: () => void }) {
  return (
    <SessionSheet
      open={props.session !== undefined}
      onClose={props.onClose}
      title="Automation run"
      description="The chat this run started. Reply to continue it."
    >
      {props.session ? <SessionThread key={props.session} sessionId={props.session} /> : null}
    </SessionSheet>
  )
}
