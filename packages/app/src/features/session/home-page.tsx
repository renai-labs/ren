import { Preference } from "../../lib/preference.js"
import { PromptInput } from "./prompt-input.js"
import { Logomark } from "../../icons/logomark.js"
import { ModelPicker, pickModel } from "../../components/model-picker.js"
import { WorkingIn } from "./working-in.js"
import { RepositoriesPicker } from "./repositories-picker.js"
import { useState } from "react"
import { Composer } from "@ren/chat"
import { useMutation } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import { toast } from "@ren/ui/sonner"
import { useMe } from "../../lib/use-me.js"
import { useModels } from "../../lib/use-models.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { errorMessage } from "../../lib/errors.js"
import { handoff } from "../../lib/chat.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Drafts } from "../../lib/drafts.js"
import { Artifacts } from "../../lib/artifacts.js"
import { useMentionSuggestions } from "./use-composer-suggestions.js"
import { ComposerMotion } from "../../lib/composer-motion.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/_authed/_shell/")

export function HomePage(props: {
  draftKey: string
  initialDraft: Composer.Draft
  artifact?: Artifacts.Mention | undefined
}) {
  const { api, platform } = RouterContext.useRouterContext()
  const me = useMe()
  const navigate = useNavigate()
  const spaces = useSpaces().joined
  const search = route.useSearch()
  const remembered = Preference.usePreference(ChatPreferences.homeSpace)
  const saved = Preference.usePreference(ChatPreferences.model)
  const setPreference = Preference.useSetPreference()
  const kept = Drafts.useDraft(props.draftKey, props.initialDraft)
  const draft = kept.draft
  const setDraft = kept.set
  const spaceId =
    draft.chat?.spaceId ?? spaces.find((space) => space.id === (search.spaceId ?? remembered))?.id ?? spaces.at(0)?.id
  const [sessionId, setSessionId] = useState(() => draft.chat?.sessionId ?? Session.ID.create())
  const [sent, setSent] = useState<Composer.Draft>()
  const [picking, setPicking] = useState(false)
  const history = Drafts.useHistory()
  const models = useModels(sessionId)
  const model = pickModel(models.models, [saved])
  const prepare = useMutation(api.chat.prepare.mutationOptions())
  const [prepared, setPrepared] = useState<ReadonlySet<string>>(() => new Set())
  const create = useMutation(api.session.create.mutationOptions())
  const mentions = useMentionSuggestions(spaceId, Composer.mentions(draft))
  const suggest = mentions.suggest
  const starting = create.isPending
  const modelsLoading = models.loading
  const chooseSpace = (next: string) => {
    setPreference(ChatPreferences.homeSpace, next)
    void navigate({ to: "/", search: { spaceId: next } })
  }
  const chooseModel = (next: SessionModel.Ref) => {
    setPreference(ChatPreferences.model, next)
  }
  const type = (next: Composer.Draft) => {
    setDraft(next)
    if (spaceId && !Composer.isBlank(next) && !prepared.has(spaceId)) {
      setPrepared(new Set([...prepared, spaceId]))
      prepare.mutate({ id: spaceId })
    }
  }
  const send = () => {
    const trimmed = Composer.message(draft).trim()
    if (!trimmed || !spaceId || create.isPending) return
    const files = Composer.files(draft)
    const message = {
      id: Composer.messageID(draft) ?? SessionMessage.ID.create(),
      text: Artifacts.resolveMention(mentions.resolve(trimmed).text, props.artifact),
      ...(files.length > 0 && { files: files.map((file) => ({ path: file.path, name: file.name })) }),
    }
    setSent(draft)
    history.prepend(draft)
    create.mutate(
      { id: sessionId, spaceId, message, ...(model && { model }) },
      {
        onSuccess: () => {
          setDraft(Composer.empty)
          handoff(platform, me.user.id, sessionId, {
            id: message.id,
            text: message.text,
            ...(files.length > 0 && { files }),
          })
          ComposerMotion.leave()
          void navigate({ to: "/sessions/$sessionId", params: { sessionId } })
        },
        onError: (error) => {
          history.remove(draft)
          setSent(undefined)
          const next = Session.ID.create()
          setSessionId(next)
          kept.update((current) =>
            current.chat ? Composer.withChat(current, { spaceId: current.chat.spaceId, sessionId: next }) : current,
          )
          toast.error("Could not start the chat", { description: errorMessage(error) })
        },
      },
    )
  }
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 pt-4">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Logomark
          outline
          className="h-[min(40vh,--spacing(84))] w-auto shrink-0 -translate-y-1/4 mask-b-from-25% mask-b-to-72% text-foreground/10"
        />
      </div>
      <div className="relative flex w-full max-w-3xl flex-col gap-2">
        <div className="relative flex flex-col gap-2">
          <PromptInput
            placement="home"
            header={
              <>
                <WorkingIn
                  spaces={spaces}
                  spaceId={spaceId}
                  disabled={starting || Boolean(draft.chat)}
                  onChange={chooseSpace}
                />
                <RepositoriesPicker spaceId={spaceId} disabled={starting || Boolean(draft.chat)} />
              </>
            }
            spaceId={spaceId}
            value={sent ?? draft}
            onChange={type}
            onSubmit={send}
            onChooseModel={() => setPicking(true)}
            sending={starting}
            files={{
              sessionId,
              spaceId,
              update: (change) =>
                kept.update((current) => {
                  const next = change(current)
                  return Composer.files(next).length > 0 && spaceId && !next.chat
                    ? Composer.withChat(next, { sessionId, spaceId })
                    : next
                }),
            }}
            suggest={suggest}
            artifact={props.artifact}
            model={
              <ModelPicker
                models={models.models}
                value={model}
                loading={modelsLoading}
                disabled={starting}
                onChange={chooseModel}
                open={picking}
                onOpenChange={setPicking}
              />
            }
          />
        </div>
      </div>
    </div>
  )
}
