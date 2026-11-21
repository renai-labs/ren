import type { ScheduleInfo, ScheduleRunInfo, WebhookInfo, WebhookRequestInfo } from "@ren/client"
import { keepPreviousData, useMutation, useQueries, useQuery, useInfiniteQuery } from "@tanstack/react-query"
import { Option } from "effect"
import { toast } from "@ren/ui/sonner"
import { SessionPages } from "@ren/client/react"
import { Automations, type Automation, type Draft } from "./automations.js"
import { errorMessage } from "./errors.js"
import { pickerPageSize } from "./pagination.js"
import { RouterContext } from "./router-context.js"
import { localTimeZone, whenOf } from "./schedules.js"
import { useSpaces } from "./use-spaces.js"
import { Webhooks } from "./webhooks.js"

export function useAutomations(spaceId: string | undefined) {
  const { api } = RouterContext.useRouterContext()
  const scope = spaceId ? { spaceId } : {}
  const schedules = useQuery({
    ...api.schedule.list.queryOptions({ ...scope, page: 1, pageSize: Automations.listSize }),
    placeholderData: keepPreviousData,
  })
  const webhooks = useQuery({
    ...api.webhook.list.queryOptions({ ...scope, page: 1, pageSize: Automations.listSize }),
    placeholderData: keepPreviousData,
    refetchInterval: Webhooks.refreshEvery,
  })
  const ready = schedules.data !== undefined && webhooks.data !== undefined
  return {
    automations: ready ? Automations.list(schedules.data.items, webhooks.data.items) : undefined,
    failed: schedules.isError || webhooks.isError,
  }
}

// oxlint-disable-next-line ren/no-comments -- The chats that schedules and webhooks started in these spaces, newest first.
export function useRuns(options: { readonly spaceId: string | undefined }) {
  const { client } = RouterContext.useRouterContext()
  const spaces = useSpaces()
  const spaceIds = options.spaceId ? [options.spaceId] : spaces.joined.map((space) => space.id)
  return useInfiniteQuery({
    ...SessionPages.options(client, {
      spaceId: spaceIds,
      origin: [...Automations.runOrigins],
      orderBy: "created",
    }),
    enabled: spaceIds.length > 0,
    placeholderData: keepPreviousData,
  })
}

export interface AppPreset extends Automations.PresetRef {
  readonly appName: string
  readonly name: string
  readonly description: string
  readonly message: string
  readonly turnedOn: boolean
}

// oxlint-disable-next-line ren/no-comments -- The webhooks that the apps a space reaches declare, and whether the space has turned each one on already.
export function useAppPresets(spaceId: string): ReadonlyArray<AppPreset> {
  const { api } = RouterContext.useRouterContext()
  const profiles = useQuery({
    ...api["app-profile"].list.queryOptions({ spaceId, page: 1, pageSize: pickerPageSize }),
    enabled: spaceId !== "",
  })
  const webhooks = useQuery({
    ...api.webhook.list.queryOptions({ spaceId, page: 1, pageSize: Automations.listSize }),
    enabled: spaceId !== "",
  })
  const appIds = [...new Set((profiles.data?.items ?? []).map((profile) => profile.appId))]
  const apps = useQueries({ queries: appIds.map((id) => api.app.get.queryOptions({ idOrSlug: id })) })
  const on = new Set(
    (webhooks.data?.items ?? []).flatMap((webhook) =>
      webhook.preset ? [`${webhook.preset.appId}/${webhook.preset.preset}`] : [],
    ),
  )
  return apps.flatMap((result) =>
    result.data
      ? Object.entries(result.data.webhooks ?? {}).map(([preset, found]) => ({
          appId: result.data.id,
          preset,
          appName: result.data.name,
          name: found.name,
          description: found.description,
          message: found.message,
          turnedOn: on.has(`${result.data.id}/${preset}`),
        }))
      : [],
  )
}

const failed = (what: string) => (error: unknown) => {
  toast.error(what, { description: errorMessage(error) })
  throw error
}

// oxlint-disable-next-line ren/no-comments -- Runs next after a write; when next fails, undo takes the write back and the error stays. A save is several calls, and this keeps it from stopping halfway.
const thenOrUndo = <A, B>(write: Promise<A>, next: (done: A) => Promise<B>, undo: (done: A) => Promise<unknown>) =>
  write.then((done) =>
    next(done).catch((error: unknown) =>
      undo(done).then(
        () => {
          throw error
        },
        () => {
          throw error
        },
      ),
    ),
  )

const testBody = () => JSON.stringify({ test: true, from: "Ren", sentAt: new Date().toISOString() })

const testOutcomes = {
  passed: "It would start a chat. Turn the automation on to run it.",
  ignored: "Its filter would skip this request.",
  rejected: "Ren would reject it: the signature did not match.",
  duplicate: "An earlier request had the same event ID.",
  answered: "A handshake would answer it.",
} as const

export interface Saved {
  readonly spaceId: string
  readonly handle: string
}

interface Created extends Saved {
  readonly schedule?: ScheduleInfo
  readonly webhook?: WebhookInfo
}

// oxlint-disable-next-line ren/no-comments -- Writes a draft to the one schedule or webhook of an automation. A new trigger, a new kind of trigger or a new space makes it again and archives the old one only after the new one is saved.
export function useAutomationActions() {
  const { api, queryClient, platform } = RouterContext.useRouterContext()
  const createSchedule = useMutation(api.schedule.create.mutationOptions())
  const updateSchedule = useMutation(api.schedule.update.mutationOptions())
  const archiveSchedule = useMutation(api.schedule.archive.mutationOptions())
  const pause = useMutation(api.schedule.pause.mutationOptions())
  const resume = useMutation(api.schedule.resume.mutationOptions())
  const runNow = useMutation(api.schedule.run.mutationOptions())
  const createWebhook = useMutation(api.webhook.create.mutationOptions())
  const updateWebhook = useMutation(api.webhook.update.mutationOptions())
  const archiveWebhook = useMutation(api.webhook.archive.mutationOptions())
  const setSecret = useMutation(api.webhook.setSigningSecret.mutationOptions())
  const revealSecret = useMutation(api.webhook.revealSigningSecret.mutationOptions())
  const dryRun = useMutation(api.webhook.test.mutationOptions())

  const takenIn = (spaceId: string, except?: Automation) =>
    Promise.all([
      queryClient.query({
        ...api.schedule.list.queryOptions({ spaceId, page: 1, pageSize: Automations.listSize }),
        staleTime: 0,
      }),
      queryClient.query({
        ...api.webhook.list.queryOptions({ spaceId, page: 1, pageSize: Automations.listSize }),
        staleTime: 0,
      }),
    ]).then(
      ([schedules, webhooks]) =>
        new Set(
          [...schedules.items, ...webhooks.items].filter((each) => each.id !== except?.key).map((each) => each.slug),
        ),
    )

  const slugFor = (draft: Draft, keep: Automation | undefined) =>
    takenIn(draft.spaceId, keep).then((taken) =>
      keep && !taken.has(keep.slug) ? keep.slug : Automations.freeSlug(draft.name, taken),
    )

  const switchSchedule = (schedule: ScheduleInfo, { active }: { readonly active: boolean }) => {
    if (active && schedule.status === "paused") return resume.mutateAsync({ id: schedule.id })
    if (!active && schedule.status === "active") return pause.mutateAsync({ id: schedule.id })
    return Promise.resolve(schedule)
  }

  const switchWebhook = (webhook: WebhookInfo, { active }: { readonly active: boolean }) => {
    if (active && webhook.mode === "listening" && Webhooks.canGoLive(webhook))
      return updateWebhook.mutateAsync({ id: webhook.id, mode: "live" })
    if (!active && webhook.mode === "live") return updateWebhook.mutateAsync({ id: webhook.id, mode: "listening" })
    return Promise.resolve(webhook)
  }

  const archive = (automation: {
    readonly schedule?: ScheduleInfo | undefined
    readonly webhook?: WebhookInfo | undefined
  }): Promise<unknown> => {
    if (automation.schedule) return archiveSchedule.mutateAsync({ id: automation.schedule.id })
    if (automation.webhook) return archiveWebhook.mutateAsync({ id: automation.webhook.id })
    return Promise.resolve()
  }

  const switchAutomation = (automation: Automation, active: { readonly active: boolean }): Promise<unknown> => {
    if (automation.schedule) return switchSchedule(automation.schedule, active)
    if (automation.webhook) return switchWebhook(automation.webhook, active)
    return Promise.resolve()
  }

  const create = (draft: Draft, slug: string): Promise<Created> => {
    const agentId = Webhooks.agentIdOf(draft.agent)
    const name = Automations.nameOrDefault(draft.name)
    const message = draft.message.trim()
    const cadence = Automations.cadenceOfDraft(draft)
    const when = cadence ? Option.getOrUndefined(whenOf(cadence)) : undefined
    const saved = { spaceId: draft.spaceId, handle: slug }
    if (when)
      return thenOrUndo(
        createSchedule.mutateAsync({
          spaceId: draft.spaceId,
          slug,
          name,
          message,
          when,
          ...(draft.target !== "new-chat" && { target: draft.target }),
          ...(agentId && { agentId }),
        }),
        (schedule) => switchSchedule(schedule, { active: draft.active }).then(() => ({ ...saved, schedule })),
        (schedule) => archive({ schedule }),
      )
    const preset = Automations.presetOfDraft(draft)
    return thenOrUndo(
      createWebhook.mutateAsync({
        spaceId: draft.spaceId,
        slug,
        ...(agentId && { agentId }),
        source: preset
          ? { _tag: "preset", appId: preset.appId, preset: preset.preset }
          : { _tag: "custom", name, message, parser: {} },
      }),
      (webhook) =>
        (draft.fallback
          ? updateWebhook.mutateAsync({ id: webhook.id, fallbackUserId: draft.fallback })
          : Promise.resolve(webhook)
        )
          .then((next) => switchWebhook(next, { active: draft.active }))
          .then(() => ({ ...saved, webhook })),
      (webhook) => archive({ webhook }),
    )
  }

  const updateInPlace = (draft: Draft, automation: Automation): Promise<Saved> => {
    const saved = { spaceId: automation.spaceId, handle: automation.handle }
    const schedule = automation.schedule
    const webhook = automation.webhook
    const cadence = Automations.cadenceOfDraft(draft)
    const when = cadence ? Option.getOrUndefined(whenOf(cadence)) : undefined
    if (schedule && when) {
      const changed = Automations.scheduleChanges(draft, schedule, when)
      const written = Object.keys(changed).length > 0
      return thenOrUndo(
        written ? updateSchedule.mutateAsync({ id: schedule.id, ...changed }) : Promise.resolve(schedule),
        (next) => switchSchedule(next, { active: draft.active }),
        () =>
          written
            ? updateSchedule.mutateAsync({ id: schedule.id, ...Automations.scheduleUndo(changed, schedule) })
            : Promise.resolve(),
      ).then(() => saved)
    }
    if (!webhook) return Promise.resolve(saved)
    const changed = Automations.webhookChanges(draft, webhook)
    const written = Object.keys(changed).length > 0
    return thenOrUndo(
      written ? updateWebhook.mutateAsync({ id: webhook.id, ...changed }) : Promise.resolve(webhook),
      (next) => switchWebhook(next, { active: draft.active }),
      () =>
        written
          ? updateWebhook.mutateAsync({ id: webhook.id, ...Automations.webhookUndo(changed, webhook) })
          : Promise.resolve(),
    ).then(() => saved)
  }

  const save = (draft: Draft, automation: Automation | undefined): Promise<Saved> => {
    if (!automation) return slugFor(draft, undefined).then((slug) => create(draft, slug))
    if (draft.spaceId === automation.spaceId && !Automations.changesKind(draft, automation))
      return updateInPlace(draft, automation)
    return slugFor(draft, draft.spaceId === automation.spaceId ? automation : undefined).then((slug) =>
      thenOrUndo(
        create(draft, slug),
        (created) => archive(automation).then(() => created),
        (created) => archive(created),
      ),
    )
  }

  const testWebhook = async (webhook: WebhookInfo) => {
    const signature = webhook.parser?.signature ?? { kind: "none" as const }
    if (signature.kind === "header") {
      const revealed = await revealSecret.mutateAsync({ id: webhook.id }).catch(failed("Couldn’t read the secret"))
      const command = `curl -X POST '${webhook.url}' -H 'content-type: application/json' -H '${signature.header}: ${revealed.secret}' -d '${testBody()}'`
      if (!platform.writeClipboardText) return
      return platform.writeClipboardText(command).then(() =>
        toast.success("Test command copied", {
          description: "Run it in a terminal. Browsers can’t send the auth header.",
        }),
      )
    }
    if (signature.kind !== "none")
      return toast.error("This webhook only takes signed requests", {
        description: "Send a test from the app that calls it.",
      })
    if (!platform.fetch) return
    const sent = await platform
      .fetch(webhook.url, { method: "POST", headers: { "content-type": "application/json" }, body: testBody() })
      .catch(failed("Couldn’t send a test request"))
    if (!sent.ok) return toast.error("The webhook didn’t take the test request", { description: `${sent.status}` })
    if (webhook.mode === "live")
      return toast.success("Test request sent", { description: "It shows in Run history in a moment." })
    const result = await dryRun.mutateAsync({ id: webhook.id }).catch(failed("Couldn’t check the test request"))
    const outcome = result.items.at(0)?.outcome
    return toast.success("Test request recorded", {
      description: outcome ? testOutcomes[outcome] : "It shows in Run history.",
    })
  }

  return {
    saving:
      createSchedule.isPending ||
      updateSchedule.isPending ||
      createWebhook.isPending ||
      updateWebhook.isPending ||
      pause.isPending ||
      resume.isPending,
    save: (draft: Draft, automation: Automation | undefined) =>
      save(draft, automation).catch(failed("Couldn’t save the automation")),
    remove: (automation: Automation) =>
      archive(automation).then(
        () => toast.success(`${automation.name} deleted`),
        failed("Couldn’t delete the automation"),
      ),
    setActive: (automation: Automation, { active }: { readonly active: boolean }) =>
      switchAutomation(automation, { active }).then(
        () => toast.success(active ? `${automation.name} is on` : `${automation.name} is off`),
        failed("Couldn’t switch the automation"),
      ),
    test: (automation: Automation) => {
      if (automation.webhook) return testWebhook(automation.webhook)
      const schedule = automation.schedule
      if (!schedule) return Promise.resolve()
      return runNow
        .mutateAsync({ id: schedule.id })
        .then(
          () => toast.success("Test run started", { description: "It shows in Run history in a moment." }),
          failed("Couldn’t start a test run"),
        )
    },
    testing: runNow.isPending || dryRun.isPending || revealSecret.isPending,
    duplicate: (automation: Automation) => {
      const draft = {
        ...Automations.draftOf(automation, automation.spaceId, localTimeZone()),
        name: `${automation.name} copy`,
        active: false,
      }
      return slugFor(draft, undefined)
        .then((slug) => create(draft, slug))
        .then((saved) => {
          toast.success(`${automation.name} duplicated`)
          return saved
        }, failed("Couldn’t duplicate the automation"))
    },
    copyJson: (automation: Automation) =>
      navigator.clipboard.writeText(Automations.json(automation)).then(() => toast.success("Copied as JSON")),
    copyUrl: (webhook: WebhookInfo) =>
      navigator.clipboard.writeText(webhook.url).then(() => toast.success("URL copied")),
    // oxlint-disable-next-line ren/no-comments -- The webhook checks that the x-ren-secret header equals its signing secret. Ren makes the secret once; later copies reveal it.
    copyAuthHeader: async (webhook: WebhookInfo) => {
      const header = (secret: string) => `${Automations.authHeader}: ${secret}`
      const copy = (secret: string) =>
        navigator.clipboard.writeText(header(secret)).then(() => toast.success("Auth header copied"))
      const signed = webhook.parser?.signature?.kind === "header" && webhook.hasSigningSecret
      if (signed) {
        const revealed = await revealSecret.mutateAsync({ id: webhook.id }).catch(failed("Couldn’t read the secret"))
        return copy(revealed.secret)
      }
      const made = await setSecret.mutateAsync({ id: webhook.id }).catch(failed("Couldn’t make a secret"))
      await updateWebhook
        .mutateAsync({
          id: webhook.id,
          parser: { ...webhook.parser, signature: { kind: "header", header: Automations.authHeader } },
        })
        .catch(failed("Couldn’t turn on the auth header"))
      return copy(made.secret)
    },
  }
}

const scheduleStatus = { pending: "Waiting", started: "Started", skipped: "Skipped", failed: "Failed" } as const

export interface Run {
  readonly id: string
  readonly trigger: string
  readonly at: string
  readonly status: string
  readonly tone: Automations.Tone
  readonly sessionId: string | null
}

const scheduleRunOf = (run: ScheduleRunInfo): Run => ({
  id: run.id,
  trigger: run.trigger === "manual" ? "Test run" : "Schedule",
  at: run.startedAt ?? run.scheduledAt,
  status: run.reason ? `Skipped · ${run.reason.replaceAll("_", " ")}` : scheduleStatus[run.status],
  tone: Automations.runTone(run.status),
  sessionId: run.sessionId,
})

const requestRunOf = (request: WebhookRequestInfo): Run => ({
  id: request.id,
  trigger: "Webhook",
  at: request.receivedAt,
  status: Webhooks.outcomes[request.outcome].label,
  tone: Automations.outcomeTone(request.outcome),
  sessionId: request.sessionId,
})

// oxlint-disable-next-line ren/no-comments -- The runs of one automation in the last 30 days: its schedule's runs and its webhook's requests, newest first.
export function useAutomationRuns(automation: Automation | undefined) {
  const { api } = RouterContext.useRouterContext()
  const scheduleId = automation?.schedule?.id
  const webhookId = automation?.webhook?.id
  const scheduleRuns = useQuery({
    ...api["schedule-run"].list.queryOptions({ scheduleId: scheduleId ?? "", page: 1, pageSize: 50 }),
    enabled: scheduleId !== undefined,
  })
  const requests = useQuery({
    ...api["webhook-request"].list.queryOptions({ webhookId: webhookId ?? "", page: 1, pageSize: 50 }),
    enabled: webhookId !== undefined,
    refetchInterval: Webhooks.refreshEvery,
  })
  const waiting = [
    { id: scheduleId, data: scheduleRuns.data },
    { id: webhookId, data: requests.data },
  ].some((query) => query.id !== undefined && query.data === undefined)
  const runs = [
    ...(scheduleRuns.data?.items ?? []).map(scheduleRunOf),
    ...(requests.data?.items ?? []).map(requestRunOf),
  ]
  return { loading: waiting, runs: runs.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at)) }
}
