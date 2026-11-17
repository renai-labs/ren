import type { Session } from "@ren/schema/session"
import { OpenPanel } from "./open-panel.js"
import { Transcript } from "./transcript.js"
import { useSubagentChat } from "./use-chat.js"
import type { Person } from "./user-message.js"

const nobody: ReadonlyMap<string, Person> = new Map()

// oxlint-disable-next-line ren/no-comments -- A subagent shown as a chat inside the workspace panel: its prompt, its live line, its folded steps and its answer, with no composer. "Worked for" expands in place, since Activity is already open.
export function SubagentThread(props: { root: Session.ID; child: Session.ID; onOpenChild: (id: Session.ID) => void }) {
  const chat = useSubagentChat(props.root, props.child)
  return (
    <OpenPanel value={undefined}>
      <Transcript
        key={props.child}
        view={chat.view}
        messages={chat.messages}
        rows={chat.rows}
        activeMessageID={chat.activeMessageID}
        busy={chat.busy}
        working={chat.working}
        simple={chat.simple}
        statuses={chat.statuses}
        viewer={chat.viewer}
        people={nobody}
        more={chat.more}
        loading={chat.loading}
        loadingHistory={chat.loadingHistory}
        onLoadMore={chat.loadMore}
        onOpenChild={props.onOpenChild}
        fold={chat.fold}
        detail={chat.detail}
        foldMessages={chat.foldMessages}
        empty="This subagent hasn’t posted anything yet."
      />
    </OpenPanel>
  )
}
