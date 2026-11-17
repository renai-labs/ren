import { Composer, ModelChoice } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { SpaceInfo } from "@ren/client"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { ErrorText } from "@ren/util/error-text"
import { Equal } from "effect"
import { type UseQueryResult, useMutation, useQuery } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { KeyboardStickyView } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { withUniwind } from "uniwind"
import { Logomark } from "#components/logomark"
import { SpacePicker } from "#components/space-picker"
import { Text } from "#components/text"
import { useAttachments } from "#features/chat/attachments"
import { MentionedApps } from "#features/chat/app-connect"
import { useMentions } from "#features/chat/mentions"
import { PromptInput } from "#features/chat/prompt-input"
import { Api } from "#lib/api"
import { Preferences } from "#lib/preferences"

const StickyView = withUniwind(KeyboardStickyView)

function SpaceRow(props: {
  readonly spaces: UseQueryResult<{ readonly items: ReadonlyArray<SpaceInfo> }>
  readonly spaceId: string | undefined
  readonly starting: boolean
  readonly locked: boolean
  readonly onChange: (spaceId: string) => void
}) {
  const spaces = props.spaces
  const joined = spaces.data?.items ?? []
  return (
    <View className="min-h-11 flex-row items-center gap-2 px-5">
      {spaces.isPending && spaces.fetchStatus === "paused" ? (
        <Text className="text-sm text-muted-foreground">You’re offline. Connect to start a chat.</Text>
      ) : null}
      {spaces.data?.items.length === 0 ? (
        <Text className="text-sm text-muted-foreground">Join a space on the web to start a chat.</Text>
      ) : null}
      {joined.length > 0 ? (
        <SpacePicker
          spaces={joined}
          spaceId={props.spaceId}
          disabled={props.starting || props.locked}
          onChange={props.onChange}
        />
      ) : null}
      {props.starting ? <ActivityIndicator colorClassName="accent-muted-foreground" size="small" /> : null}
    </View>
  )
}

export default function NewChat() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const atoms = ChatReact.useAtoms()
  const spaces = useQuery(Api.query.space.list.queryOptions({ joined: true, page: 1, pageSize: 100 }))
  const joined = spaces.data?.items ?? []
  const [remembered, setRemembered] = Preferences.usePreference(Preferences.homeSpace)
  const spaceId = (joined.find((space) => space.id === remembered) ?? joined.at(0))?.id
  const prepare = useMutation(Api.query.chat.prepare.mutationOptions())
  const [prepared, setPrepared] = useState<ReadonlySet<string>>(() => new Set())
  const create = useMutation(Api.query.session.create.mutationOptions())
  const [sessionId, setSessionId] = useState(() => Session.ID.create())
  const [draft, setDraft] = useState<Composer.Draft>(Composer.empty)
  const attachments = useAttachments({ sessionId, spaceId, draft, update: setDraft })
  const catalog = useQuery(Api.query.chat.models.queryOptions({ id: sessionId, ...(spaceId && { spaceId }) })).data
  const models = catalog?.models ?? []
  const model = ModelChoice.pick(models, [draft.model, catalog?.default])
  const [error, setError] = useState("")
  const [preparing, setPreparing] = useState(false)
  const mentions = useMentions({ root: undefined, spaceId, draft, update: setDraft, onError: setError })
  const starting = create.isPending || preparing

  const type = (next: string) => {
    mentions.change(next)
    if (spaceId && next.trim() && !prepared.has(spaceId)) {
      setPrepared(new Set([...prepared, spaceId]))
      prepare.mutate({ id: spaceId })
    }
  }
  const send = () => {
    const trimmed = draft.text.trim()
    if (!trimmed || !spaceId || starting) return
    const files = Composer.files(draft)
    const id = Composer.messageID(draft) ?? SessionMessage.ID.create()
    const chosen = Equal.equals(model, catalog?.default) ? undefined : model
    const text = mentions.resolve(trimmed).text
    setError("")
    setPreparing(true)
    void mentions
      .prepare()
      .then(() =>
        create.mutate(
          {
            id: sessionId,
            spaceId,
            message: {
              id,
              text,
              ...(files.length > 0 && { files: files.map((file) => ({ path: file.path, name: file.name })) }),
            },
            ...(chosen && { model: chosen }),
          },
          {
            onSuccess: () => {
              atoms.handoff(sessionId, { id, text, ...(files.length > 0 && { files }) })
              setDraft(Composer.empty)
              setSessionId(Session.ID.create())
              router.navigate({ pathname: "/chat/[id]", params: { id: sessionId } })
            },
            onError: (cause) => {
              setSessionId(Session.ID.create())
              setError(ErrorText.of(cause, "Couldn’t start the chat. Try again."))
            },
          },
        ),
      )
      .finally(() => setPreparing(false))
  }

  return (
    <View className="flex-1 bg-background">
      <View pointerEvents="none" aria-hidden className="flex-1 items-center justify-center p-10">
        <View className="aspect-[0.875] max-h-72 flex-1 opacity-10">
          <Logomark outline className="size-full text-foreground" />
        </View>
      </View>
      <StickyView offset={{ opened: insets.bottom }} className="gap-1 pb-safe-offset-6">
        {error ? <Text className="px-5 text-sm text-destructive">{error}</Text> : null}
        <SpaceRow
          spaces={spaces}
          spaceId={spaceId}
          starting={starting}
          locked={attachments.files.length + attachments.uploads.length > 0}
          onChange={setRemembered}
        />
        <MentionedApps spaceId={spaceId} apps={mentions.mentioned} />
        <PromptInput
          value={draft.text}
          onChange={type}
          onSend={send}
          onStop={send}
          running={false}
          attachments={attachments}
          suggest={mentions.suggestions}
          {...(spaceId && { space: { id: spaceId, onMentionApp: mentions.mention } })}
          model={{
            models,
            value: model,
            disabled: starting,
            onChange: (next) => setDraft((current) => Composer.withModel(current, next)),
          }}
        />
      </StickyView>
    </View>
  )
}
