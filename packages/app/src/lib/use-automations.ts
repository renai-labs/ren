import type { ScheduleInfo, ScheduleRunInfo, WebhookInfo, WebhookRequestInfo } from "@ren/client"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { Option } from "effect"
import { toast } from "@ren/ui/sonner"
import { Automations, type Automation, type Draft } from "./automations.js"
import { errorMessage } from "./errors.js"
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
    automations: ready ? Automations.group(schedules.data.items, webhooks.data.items) : undefined,
    failed: schedules.isError || webhooks.isError,
  }
}

// oxlint-disable-next-line ren/no-comments -- The chats that schedules and webhooks started in these spaces, newest first.
export function useRuns(options: {
  readonly spaceId: string | undefined
  readonly page: number
  readonly pageSize: number
  readonly from?: string | undefined
}) {
  const { api } = RouterContext.useRouterContext()
  const spaces = useSpaces()
  const spaceIds = options.spaceId ? [options.spaceId] : spaces.joined.map((space) => space.id)
  return useQuery({
    ...api.session.list.queryOptions({
      spaceId: spaceIds,
      origin: [...Automations.runOrigins],
      orderBy: "created",
      page: options.page,
      pageSize: options.pageSize,
      ...(options.from && { from: options.from }),
    }),
    enabled: spaceIds.length > 0,
    placeholderData: keepPreviousData,
  })
}

const failed = (what: string) => (error: unknown) => {
  toast.error(what, { description: errorMessage(error) })
  throw error
}

// oxlint-disable-next-line ren/no-comments -- Writes a draft to the schedule and the webhook of an automation: it adds, changes or archives each trigger, keeps the name, the instructions and the agent the same on both, and turns them on or off together.
interface Saved {
  readonly spaceId: string
  readonly slug: string
}

export function useAutomationActions() {
  const { api } = RouterContext.useRouterContext()
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

  const created = (draft: Draft, slug: string | undefined) => {
    const agentId = Webhooks.agentIdOf(draft.agent)
    return {
      spaceId: draft.spaceId,
      name: Automations.nameOrDefault(draft.name),
      message: draft.message.trim(),
      ...(slug && { slug }),
      ...(agentId && { agentId }),
    }
  }

  const writeSchedule = async (
    draft: Draft,
    current: ScheduleInfo | undefined,
    slug: string | undefined,
  ): Promise<ScheduleInfo | null> => {
    const when = draft.schedule ? Option.getOrUndefined(whenOf(draft.schedule)) : undefined
    if (!when) {
      if (current) await archiveSchedule.mutateAsync({ id: current.id })
      return null
    }
    if (!current) return createSchedule.mutateAsync({ ...created(draft, slug), when })
    const changed = Automations.scheduleChanges(draft, current, when)
    return Object.keys(changed).length > 0 ? updateSchedule.mutateAsync({ id: current.id, ...changed }) : current
  }

  const writeWebhook = async (
    draft: Draft,
    current: WebhookInfo | undefined,
    slug: string | undefined,
  ): Promise<WebhookInfo | null> => {
    if (!draft.webhook) {
      if (current) await archiveWebhook.mutateAsync({ id: current.id })
      return null
    }
    if (!current) {
      const { name, message, ...rest } = created(draft, slug)
      return createWebhook.mutateAsync({ ...rest, source: { _tag: "custom", name, message, parser: {} } })
    }
    const changed = Automations.webhookChanges(draft, current)
    return Object.keys(changed).length > 0 ? updateWebhook.mutateAsync({ id: current.id, ...changed }) : current
  }

  const switchSchedule = async (
    schedule: ScheduleInfo | null | undefined,
    { active }: { readonly active: boolean },
  ) => {
    if (!schedule || schedule.status === "ended") return
    if (active && schedule.status === "paused") await resume.mutateAsync({ id: schedule.id })
    if (!active && schedule.status === "active") await pause.mutateAsync({ id: schedule.id })
  }

  const switchWebhook = async (webhook: WebhookInfo | null | undefined, { active }: { readonly active: boolean }) => {
    if (!webhook) return
    if (active && webhook.mode === "listening" && Webhooks.canGoLive(webhook))
      await updateWebhook.mutateAsync({ id: webhook.id, mode: "live" })
    if (!active && webhook.mode === "live") await updateWebhook.mutateAsync({ id: webhook.id, mode: "listening" })
  }

  const archiveAll = async (automation: Automation) => {
    if (automation.schedule) await archiveSchedule.mutateAsync({ id: automation.schedule.id })
    if (automation.webhook) await archiveWebhook.mutateAsync({ id: automation.webhook.id })
  }

  const save = async (draft: Draft, automation: Automation | undefined): Promise<Saved> => {
    // oxlint-disable-next-line ren/no-comments -- A schedule or a webhook stays in its space, so a move makes them again in the new space and archives the old ones.
    if (automation && draft.spaceId !== automation.spaceId) {
      const moved = await save(draft, undefined)
      await archiveAll(automation)
      return moved
    }
    const slug = automation?.slug
    const schedule = await writeSchedule(draft, automation?.schedule, slug)
    const webhook = await writeWebhook(draft, automation?.webhook, slug ?? schedule?.slug)
    await switchSchedule(schedule, { active: draft.active })
    await switchWebhook(webhook, { active: draft.active })
    return { spaceId: draft.spaceId, slug: [schedule?.slug, webhook?.slug, slug].find(Boolean) ?? "" }
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
      archiveAll(automation).then(
        () => toast.success(`${automation.name} deleted`),
        failed("Couldn’t delete the automation"),
      ),
    setActive: (automation: Automation, { active }: { readonly active: boolean }) =>
      Promise.all([
        switchSchedule(automation.schedule, { active }),
        switchWebhook(automation.webhook, { active }),
      ]).then(
        () => toast.success(active ? `${automation.name} is on` : `${automation.name} is off`),
        failed("Couldn’t switch the automation"),
      ),
    test: (automation: Automation) => {
      const schedule = automation.schedule
      if (!schedule) return Promise.resolve()
      return runNow
        .mutateAsync({ id: schedule.id })
        .then(
          () => toast.success("Test run started", { description: "It shows in Run history in a moment." }),
          failed("Couldn’t start a test run"),
        )
    },
    testing: runNow.isPending,
    duplicate: (automation: Automation) =>
      save(
        {
          ...Automations.draftOf(automation, automation.spaceId, localTimeZone()),
          name: `${automation.name} copy`,
          active: false,
        },
        undefined,
      ).then((saved) => {
        toast.success(`${automation.name} duplicated`)
        return saved
      }, failed("Couldn’t duplicate the automation")),
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
