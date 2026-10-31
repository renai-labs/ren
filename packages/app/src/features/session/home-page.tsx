import { PromptInput } from "./prompt-input.js"
import { Logomark } from "../../components/logomark.js"
import { ModelPicker, pickModel } from "../../components/model-picker.js"
import { WorkingIn } from "./working-in.js"
import { useState } from "react"
import { Composer } from "@ren/chat"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
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
import { useMentionSuggestions } from "./use-composer-suggestions.js"
import { RouterContext } from "../../lib/router-context.js"

export function HomePage() {
  const { api, platform } = RouterContext.useRouterContext()
  const me = useMe()
  const navigate = useNavigate()
  const spaces = useSpaces().joined
  const [remembered, setRemembered] = useState(() => ChatPreferences.homeSpace.read(platform.storage))
  const spaceId = spaces.find((space) => space.id === remembered)?.id ?? spaces.at(0)?.id
  const [sessionId, setSessionId] = useState(() => Session.ID.create())
  const kept = Drafts.useDraft(Drafts.fresh)
  const draft = kept.draft
  const setDraft = kept.set
  const [sent, setSent] = useState<Composer.Draft>()
  const models = useModels(sessionId)
  const [saved, setSaved] = useState(() => ChatPreferences.model.read(platform.storage))
  const model = pickModel(models.models, [saved])
  const prepare = useMutation(api.chat.prepare.mutationOptions())
  const [prepared, setPrepared] = useState<ReadonlySet<string>>(() => new Set())
  const create = useMutation(api.session.create.mutationOptions())
  const mentions = useMentionSuggestions()
  const suggest = mentions.suggest
  const starting = create.isPending
  const modelsLoading = models.loading
  const chooseSpace = (next: string) => {
    ChatPreferences.homeSpace.write(platform.storage, next)
    setRemembered(next)
  }
  const chooseModel = (next: SessionModel.Ref) => {
    ChatPreferences.model.write(platform.storage, next)
    setSaved(next)
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
    const message = { id: SessionMessage.ID.create(), text: mentions.resolve(trimmed).text }
    setSent(draft)
    create.mutate(
      { id: sessionId, spaceId, message, ...(model && { model }) },
      {
        onSuccess: () => {
          setDraft(Composer.empty)
          handoff(platform, me.user.id, sessionId, message)
          void navigate({ to: "/sessions/$sessionId", params: { sessionId } })
        },
        onError: (error) => {
          setSent(undefined)
          setSessionId(Session.ID.create())
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
          <WorkingIn spaces={spaces} spaceId={spaceId} disabled={starting} onChange={chooseSpace} />
          <PromptInput
            placement="home"
            spaceId={spaceId}
            value={sent ?? draft}
            onChange={type}
            onSubmit={send}
            sending={starting}
            suggest={suggest}
            model={
              <ModelPicker
                models={models.models}
                value={model}
                loading={modelsLoading}
                disabled={starting}
                onChange={chooseModel}
              />
            }
          />
        </div>
      </div>
    </div>
  )
}
