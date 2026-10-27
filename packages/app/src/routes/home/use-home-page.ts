import { useState } from "react"
import { Composer } from "@ren/chat"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { toast } from "sonner"
import { pickModel } from "@/components/ren/model-picker"
import { useMe } from "@/hooks/use-me"
import { useModels } from "@/hooks/use-models"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage } from "@/lib/api"
import { handoff } from "@/lib/chat"
import { chooseHomeSpace, chooseModel, useChosenModel, useHomeSpaceId } from "@/stores/ui"
import { useMentionSuggestions } from "@/routes/chat/use-composer-suggestions"

export function useHomePage() {
  const me = useMe()
  const navigate = useNavigate()
  const spaces = useSpaces().joined
  const remembered = useHomeSpaceId()
  const spaceId = spaces.find((space) => space.id === remembered)?.id ?? spaces.at(0)?.id
  const [sessionId, setSessionId] = useState(() => Session.ID.create())
  const [draft, setDraft] = useState<Composer.Draft>(Composer.empty)
  const [sent, setSent] = useState<Composer.Draft>()
  const models = useModels(sessionId)
  const saved = useChosenModel()
  const model = pickModel(models.models, [saved])
  const prepare = useMutation(api.chat.prepare.mutationOptions())
  const [prepared, setPrepared] = useState<ReadonlySet<string>>(() => new Set())
  const create = useMutation(api.session.create.mutationOptions())
  const mentions = useMentionSuggestions()
  return {
    suggest: mentions.suggest,
    spaces,
    spaceId,
    draft,
    sent,
    starting: create.isPending,
    models: models.models,
    modelsLoading: models.loading,
    model,
    chooseSpace: chooseHomeSpace,
    chooseModel,
    type: (next: Composer.Draft) => {
      setDraft(next)
      if (spaceId && !Composer.isBlank(next) && !prepared.has(spaceId)) {
        setPrepared(new Set([...prepared, spaceId]))
        prepare.mutate({ id: spaceId })
      }
    },
    send: () => {
      const trimmed = Composer.message(draft).trim()
      if (!trimmed || !spaceId || create.isPending) return
      const message = { id: SessionMessage.ID.create(), text: mentions.resolve(trimmed).text }
      setSent(draft)
      create.mutate(
        { id: sessionId, spaceId, message, ...(model && { model }) },
        {
          onSuccess: () => {
            handoff(me.user.id, sessionId, message)
            void navigate({ to: "/sessions/$sessionId", params: { sessionId } })
          },
          onError: (error) => {
            setSent(undefined)
            setSessionId(Session.ID.create())
            toast.error("Could not start the chat", { description: errorMessage(error) })
          },
        },
      )
    },
  }
}
