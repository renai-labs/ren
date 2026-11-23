export * as RenCommands from "./commands.js"

import type { Plugin } from "@opencode/plugin/tui"
import { Form } from "@ren/schema/form"
import { Option, Schema, Struct } from "effect"
import { RenRpc } from "./rpc.js"

type Context = Plugin.Context

export interface Surface {
  readonly client: Pick<Context["client"], "rpc" | "experimental">
  readonly location: () => Context["location"]
  readonly ui: {
    readonly dialog: Pick<Context["ui"]["dialog"], "select" | "confirm">
    readonly toast: Context["ui"]["toast"]
    readonly router: Pick<Context["ui"]["router"], "navigate" | "current">
    readonly model: Pick<Context["ui"]["model"], "current">
  }
}

export interface SignInSurface extends Surface {
  readonly open: (url: string) => void
  readonly ui: Surface["ui"] & {
    readonly dialog: Pick<Context["ui"]["dialog"], "prompt" | "clear">
  }
}

export interface OpenSurface extends Surface {
  readonly client: Pick<Context["client"], "rpc" | "experimental" | "session">
  readonly reload: (sessionID: string, load: () => Promise<unknown>) => Promise<void>
  readonly ui: Surface["ui"] & {
    readonly dialog: Pick<Context["ui"]["dialog"], "select" | "prompt">
  }
}

const Failure = Schema.Struct({ type: Schema.optionalKey(Schema.String), message: Schema.String })

const at = (surface: Pick<Surface, "location">) => {
  const location = surface.location()
  return location && { location }
}

const fail = (surface: Surface) => (error: unknown) => {
  const failure = Schema.decodeUnknownOption(Failure)(error).pipe(
    Option.getOrElse(() => ({ type: undefined, message: "Ren did not answer." })),
  )
  const signedOut = failure.type === "signed_out"
  surface.ui.toast.show({
    title: signedOut ? "Sign in to Ren" : "Ren",
    message: failure.message,
    variant: signedOut ? "warning" : "error",
  })
}

export const space = (surface: Surface) => {
  const rpc = surface.client.rpc(RenRpc.Definition)
  return rpc
    .listSpaces({}, at(surface))
    .then(async (listed) => {
      const chosen = await surface.ui.dialog.select({
        title: "Ren space",
        placeholder: "Search spaces",
        options: listed.spaces.map((each) => ({ title: each.name, value: each.id, description: each.slug })),
        ...(listed.selected && { current: listed.selected }),
        search: (query, options) =>
          options.filter((option) => option.title.toLowerCase().includes(query.trim().toLowerCase())),
      })
      if (!chosen || chosen === listed.selected) return
      const selected = await rpc.selectSpace({ spaceId: chosen }, at(surface))
      surface.ui.toast.show({ message: `Ren space: ${selected.name}`, variant: "success" })
    })
    .catch(fail(surface))
}

export const create = (surface: Surface) => {
  const model = surface.ui.model.current()
  return surface.client
    .rpc(RenRpc.Definition)
    .createSession(
      model?.providerID === "ren"
        ? { model: { id: model.modelID, ...(model.variant && { variant: model.variant }) } }
        : {},
      at(surface),
    )
    .then((created) => surface.ui.router.navigate({ type: "session", sessionID: created.sessionID }))
    .catch(fail(surface))
}

export const move = (surface: Surface) => {
  const route = surface.ui.router.current()
  if (route.type !== "session") {
    surface.ui.toast.show({ title: "Ren", message: "Open the session to move to Ren first.", variant: "warning" })
    return Promise.resolve()
  }
  const rpc = surface.client.rpc(RenRpc.Definition)
  const model = surface.ui.model.current()
  return rpc
    .getSpace({}, at(surface))
    .then(async (space) => {
      const confirmed = await surface.ui.dialog.confirm({
        title: "Move to Ren",
        message: `Move this session to the Ren space ${space.name}? Its history goes with it, the members of ${space.name} can open it, and its next messages run on Ren, which cannot reach this computer’s files.`,
        label: { confirm: "Move" },
      })
      if (!confirmed) return
      surface.ui.toast.show({ message: `Moving the session to ${space.name}…`, variant: "info" })
      const transcript = await surface.client.experimental.session.export({ sessionID: route.sessionID })
      await rpc.moveSession(
        {
          sessionID: route.sessionID,
          transcript: Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(JSON.stringify(transcript)),
          ...(model?.providerID === "ren" && {
            model: { id: model.modelID, ...(model.variant && { variant: model.variant }) },
          }),
        },
        at(surface),
      )
      surface.ui.toast.show({ message: `Moved to Ren space ${space.name}`, variant: "success" })
    })
    .catch(fail(surface))
}

export const selected = (surface: Pick<Surface, "client" | "location">) =>
  surface.client
    .rpc(RenRpc.Definition)
    .getSpace({}, at(surface))
    .then(
      (space): RenRpc.SpaceInfo | undefined => space,
      () => undefined,
    )

const fromEnvironment = (surface: Surface) =>
  surface.ui.toast.show({
    title: "Ren",
    message: "Ren uses REN_TOKEN from the environment. Unset it to sign in or out from OpenCode.",
    variant: "warning",
  })

type Outcome =
  | { readonly type: "signed_in"; readonly user: RenRpc.User }
  | { readonly type: "failed"; readonly message: string }

export const login = (surface: SignInSurface) => {
  const rpc = surface.client.rpc(RenRpc.Definition)
  const attempt = crypto.randomUUID()
  const outcome = Promise.withResolvers<Outcome>()
  const stops = [
    rpc.events.on("signedIn", (event) => {
      if (event.data.attempt === attempt) outcome.resolve({ type: "signed_in", user: event.data.user })
    }),
    rpc.events.on("loginFailed", (event) => {
      if (event.data.attempt === attempt) outcome.resolve({ type: "failed", message: event.data.message })
    }),
  ]
  const settled = outcome.promise.then((result) => {
    surface.ui.dialog.clear()
    return result
  })
  const wait = (url: string): Promise<Outcome | undefined> =>
    Promise.race([
      settled,
      surface.ui.dialog
        .prompt({
          title: "Sign in to Ren",
          description: `Sign in to Ren in your browser:\n${url}\n\nThis closes once you are signed in. If the browser cannot reach this machine, paste the address it was sent to.`,
          placeholder: "Redirect URL",
        })
        .then((answer) => ({ type: "answer" as const, answer })),
    ]).then((next) => {
      if (next.type !== "answer") return next
      if (!next.answer?.trim())
        return Promise.race([settled, rpc.cancelLogin({ attempt }, at(surface)).then(() => undefined)])
      return rpc.completeLogin({ attempt, url: next.answer }, at(surface)).then(
        () => settled,
        (error: unknown) => {
          fail(surface)(error)
          return wait(url)
        },
      )
    })
  return rpc
    .account({}, at(surface))
    .then(async (account) => {
      if (account.environment) return fromEnvironment(surface)
      if (
        account.user &&
        !(await surface.ui.dialog.confirm({
          title: "Ren",
          message: `Signed in to ${account.server} as ${account.user.name} (${account.user.email}). Sign in again?`,
        }))
      )
        return
      const started = await rpc.login({ attempt }, at(surface))
      surface.open(started.url)
      const result = await wait(started.url)
      if (result?.type === "signed_in")
        surface.ui.toast.show({
          message: `Signed in to Ren as ${result.user.name} (${result.user.email}).`,
          variant: "success",
        })
      if (result?.type === "failed")
        surface.ui.toast.show({ title: "Sign in to Ren", message: result.message, variant: "error" })
    })
    .catch(fail(surface))
    .finally(() => {
      for (const stop of stops) stop()
    })
}

export const logout = (surface: Surface) => {
  const rpc = surface.client.rpc(RenRpc.Definition)
  return rpc
    .account({}, at(surface))
    .then(async (account) => {
      if (account.environment) return fromEnvironment(surface)
      const result = await rpc.logout({}, at(surface))
      surface.ui.toast.show(
        result.signedOut
          ? { message: `Signed out of ${result.server}.`, variant: "success" }
          : { message: `Not signed in to ${result.server}.`, variant: "info" },
      )
    })
    .catch(fail(surface))
}

export interface RequestSurface extends Surface {
  readonly client: Pick<Context["client"], "rpc" | "experimental" | "session">
}

const shown = Schema.is(Schema.Struct({ _tag: Schema.Literal("ConflictError") }))

const show = (surface: RequestSurface, form: RenRpc.LocalForm) =>
  surface.client.session.form.create(form).then(
    () => undefined,
    (error: unknown) => {
      if (!shown(error))
        surface.ui.toast.show({
          title: "Ren",
          message: `Could not show the question “${form.title}”.`,
          variant: "error",
        })
    },
  )

const dismiss = (surface: RequestSurface, ref: RenRpc.FormRef) =>
  surface.client.session.form.cancel(ref).then(
    () => undefined,
    () => undefined,
  )

export const syncRequests = (surface: RequestSurface) =>
  surface.client
    .rpc(RenRpc.Definition)
    .requests({}, at(surface))
    .then((listed) =>
      Promise.all([
        ...listed.forms.map((form) => show(surface, form)),
        ...listed.closed.map((ref) => dismiss(surface, ref)),
      ]),
    )
    .then(
      () => undefined,
      () => undefined,
    )

export const requests = async (surface: RequestSurface) => {
  const rpc = surface.client.rpc(RenRpc.Definition)
  const stops = [
    rpc.events.on("formAsked", (event) => {
      void show(surface, event.data)
    }),
    rpc.events.on("requestClosed", (event) => {
      surface.ui.toast.show({ title: "Ren", message: event.data.message, variant: "info" })
      if (event.data.kind === "form")
        void dismiss(surface, { sessionID: event.data.sessionID, formID: Form.ID.make(event.data.id) })
    }),
  ]
  await syncRequests(surface)
  return () => {
    for (const stop of stops) stop()
  }
}

const origins: Record<RenRpc.SessionSummary["origin"], string> = {
  chat: "",
  task: "task",
  schedule: "schedule",
  webhook: "webhook",
  slack: "Slack",
  linear: "Linear",
  github: "GitHub",
  opencode: "OpenCode",
}

const refresh = async (surface: OpenSurface, sessionId: string, options: { readonly existing: boolean }) => {
  const rpc = surface.client.rpc(RenRpc.Definition)
  const queued = await surface.client.session.inbox.list({ sessionID: sessionId }).then(
    (items) => items.length > 0,
    () => false,
  )
  const first = await rpc.openSession({ sessionId, existing: options.existing, queued }, at(surface))
  if (!first.import) return { ...first, imported: false }
  const location = surface.location()
  const data = first.import
  await surface.reload(first.sessionID, () =>
    surface.client.experimental.session.import({ ...data, ...(location && { location }) }),
  )
  return { ...(await rpc.openSession({ sessionId, imported: true }, at(surface))), imported: true }
}

const behind = (surface: OpenSurface, outcome: RenRpc.Outcome) => {
  if (outcome === "busy")
    surface.ui.toast.show({
      title: "Ren",
      message: "This session is behind Ren. It catches up when its turn ends.",
      variant: "info",
    })
  if (outcome === "unsent")
    surface.ui.toast.show({
      title: "Ren",
      message:
        "This session is behind Ren, but it has messages Ren does not have yet, so it keeps them. Send a message to deliver them.",
      variant: "warning",
    })
}

export const open = (surface: OpenSurface, sessionId: string) =>
  refresh(surface, sessionId, { existing: false })
    .then((opened) => {
      surface.ui.router.navigate({ type: "session", sessionID: opened.sessionID })
      behind(surface, opened.outcome)
    })
    .catch(fail(surface))

export const catchUp = (surface: OpenSurface, sessionId: string) =>
  refresh(surface, sessionId, { existing: true }).then(
    (opened) => {
      if (opened.imported) surface.ui.router.navigate({ type: "session", sessionID: opened.sessionID })
      behind(surface, opened.outcome)
    },
    () => undefined,
  )

export const sessions = (surface: OpenSurface, filter: RenRpc.Filter = {}): Promise<void> =>
  surface.client
    .rpc(RenRpc.Definition)
    .listSessions(filter, at(surface))
    .then(async (listed) => {
      const now = Date.now()
      const chosen = await surface.ui.dialog.select({
        title: `${filter.scope === "space" ? "Ren sessions" : "Your Ren sessions"} in ${listed.space.name}${filter.search ? `: “${filter.search}”` : ""}`,
        placeholder: "Filter",
        options: listed.sessions.map((each) => {
          const minutes = Math.max(0, Math.round((now - each.updated) / 60_000))
          const unit = [
            { size: 1440, label: "d" },
            { size: 60, label: "h" },
          ].find((step) => minutes >= step.size) ?? { size: 1, label: "m" }
          return {
            title: each.title ?? "Untitled",
            value: each.id,
            description: [
              each.startedBy,
              `${Math.round(minutes / unit.size)}${unit.label} ago`,
              each.status === "busy" ? "working" : "idle",
              origins[each.origin],
            ]
              .filter(Boolean)
              .join(" · "),
            ...(each.local && { footer: "local" }),
          }
        }),
        search: (query, options) =>
          options.filter((option) =>
            `${option.title} ${option.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
          ),
        actions: [
          {
            bind: "ctrl+s",
            title: filter.scope === "space" ? "Only mine" : "Everyone’s",
            selection: "none",
            onTrigger: () =>
              void sessions(surface, {
                ...Struct.omit(filter, ["scope"]),
                scope: filter.scope === "space" ? "mine" : "space",
              }),
          },
          {
            bind: "ctrl+f",
            title: "Search Ren",
            selection: "none",
            onTrigger: () =>
              void surface.ui.dialog
                .prompt({ title: "Search Ren sessions", placeholder: "Words in a title or a message" })
                .then((text) =>
                  // ast-grep-ignore: no-nullish-comparison, -- an empty search clears the search; only escape cancels
                  text === undefined
                    ? undefined
                    : sessions(surface, {
                        ...Struct.omit(filter, ["search"]),
                        ...(text.trim() && { search: text.trim() }),
                      }),
                ),
          },
        ],
      })
      if (chosen) await open(surface, chosen)
    })
    .catch(fail(surface))

const retried: Record<RenRpc.Retried, string> = {
  restarted: "Ren is starting this session’s brain again.",
  restarted_resent: "Ren is starting this session’s brain again. Your last message goes to it once it is ready.",
  resumed: "Sent your last message to Ren again.",
  sent_again: "Ren had your last message and its turn failed, so it was sent again.",
  running: "Ren is still working on this session.",
  nothing: "Nothing to retry: the last turn of this Ren session did not fail.",
}

export const retry = (surface: Surface, session: { readonly sessionID?: string; readonly running: boolean }) => {
  const sessionID = session.sessionID
  if (!sessionID || session.running) {
    surface.ui.toast.show({
      title: "Ren",
      message: sessionID ? retried.running : "Open a Ren session to retry it.",
      variant: "info",
    })
    return Promise.resolve()
  }
  return surface.client
    .rpc(RenRpc.Definition)
    .retry({ sessionID }, at(surface))
    .then((result) =>
      surface.ui.toast.show({
        title: "Ren",
        message: retried[result.outcome],
        variant: result.outcome === "nothing" ? "info" : "success",
      }),
    )
    .catch((error: unknown) =>
      Schema.decodeUnknownOption(Failure)(error).pipe(Option.exists((failure) => failure.type === "rpc.unavailable"))
        ? surface.ui.toast.show({
            title: "Ren",
            message: "The Ren plugin is not running in this OpenCode server.",
            variant: "error",
          })
        : fail(surface)(error),
    )
}

export const sessionStatus = (surface: Pick<Surface, "client" | "location">, sessionID: string) =>
  surface.client
    .rpc(RenRpc.Definition)
    .sessionStatus({ sessionID }, at(surface))
    .then(
      (status): RenRpc.SessionStatus | undefined => status,
      () => undefined,
    )

export const describe = (status: RenRpc.SessionStatus, view: { readonly now: number; readonly running: boolean }) => {
  const waiting = status.retryAt - view.now
  const states: Partial<Record<RenRpc.SessionStatus["state"], string>> = {
    checking: "Checking",
    starting: `Starting: ${status.detail}`,
    reconnecting: waiting >= 2_000 ? `Waiting ${Math.ceil(waiting / 1_000)}s` : "Reconnecting",
    failed: `Failed: ${status.detail} · /ren:retry`,
    stopped: "Stopped: the space was shut down · /ren:retry",
    signed_out: "Signed out · /ren:login",
  }
  const state = states[status.state] ?? (status.busy && !view.running ? "Working" : undefined)
  return [status.space ? `ren · ${status.space}` : "ren", ...(state ? [state] : [])].join(" · ")
}

export interface PanelSurface extends Surface {
  readonly ui: Surface["ui"] & {
    readonly panel: Pick<Context["ui"]["panel"], "open">
  }
}

export const panels = {
  changes: "ren.changes",
  files: "ren.files",
  shells: "ren.shells",
  activity: "ren.activity",
} as const

const current = (surface: PanelSurface) => {
  const route = surface.ui.router.current()
  if (route.type !== "session")
    surface.ui.toast.show({ title: "Ren", message: "Open a Ren session first.", variant: "warning" })
  return route.type === "session" ? route.sessionID : ""
}

export const files = (surface: PanelSurface, panel: (typeof panels)["changes" | "files"]) => {
  const sessionID = current(surface)
  if (!sessionID) return Promise.resolve(false)
  return surface.client
    .rpc(RenRpc.Definition)
    .listFiles({ sessionID }, at(surface))
    .then(() => surface.ui.panel.open(panel))
    .catch((error: unknown) => {
      fail(surface)(error)
      return false
    })
}

export const shell = async (surface: PanelSurface, command: string | undefined): Promise<RenRpc.ShellInfo | void> => {
  const sessionID = current(surface)
  if (!sessionID) return
  const rpc = surface.client.rpc(RenRpc.Definition)
  const started: Promise<RenRpc.ShellInfo | undefined> = command?.trim()
    ? rpc.runShell({ sessionID, command: command.trim() }, at(surface))
    : rpc.listShells({ sessionID }, at(surface)).then(() => undefined)
  return started
    .then((shell) => {
      surface.ui.panel.open(panels.shells)
      return shell
    })
    .catch(fail(surface))
}

export interface InfoSurface extends Surface {
  readonly open: (url: string) => boolean
  readonly ui: Surface["ui"] & {
    readonly dialog: Pick<Context["ui"]["dialog"], "select" | "alert">
  }
}

export const sessionInfo = (surface: Pick<Surface, "client" | "location">, sessionID: string) =>
  surface.client
    .rpc(RenRpc.Definition)
    .sessionInfo({ sessionID }, at(surface))
    .then(
      (info): RenRpc.Details | undefined => info,
      () => undefined,
    )

const taskStates: Record<RenRpc.Details["links"]["tasks"][number]["status"], string> = {
  backlog: "backlog",
  todo: "to do",
  in_progress: "in progress",
  done: "done",
  dismissed: "dismissed",
}

const channels: Record<RenRpc.Details["links"]["threads"][number]["provider"], { title: string; prefix: string }> = {
  slack: { title: "Slack", prefix: "#" },
  github: { title: "GitHub", prefix: "" },
  linear: { title: "Linear", prefix: "" },
}

const repositoryOf = (url: string) => URL.parse(url)?.pathname.split("/").slice(1, 3).join("/") ?? url

export interface LinkRow {
  readonly group: "Tasks" | "Pull requests" | "Issues" | "Threads"
  readonly title: string
  readonly detail: string
  readonly url: string
}

export const linkRows = (info: RenRpc.Details): ReadonlyArray<LinkRow> => {
  const pulls = new Map(info.pullRequests.map((pull) => [pull.url, pull]))
  return [
    ...info.links.tasks.map((task) => ({
      group: "Tasks" as const,
      title: `${task.identifier} ${task.title}`,
      detail: taskStates[task.status],
      url: `${info.app}/tasks/${task.id}`,
    })),
    ...info.links.pullRequests.map((pull) => ({
      group: "Pull requests" as const,
      title: pulls.get(pull.url)?.title ?? repositoryOf(pull.url),
      detail: [`#${pull.number}`, pulls.get(pull.url)?.state].filter(Boolean).join(" · "),
      url: pull.url,
    })),
    ...info.links.issues.map((issue) => ({
      group: "Issues" as const,
      ...(issue.kind === "github_issue"
        ? { title: repositoryOf(issue.url), detail: `#${URL.parse(issue.url)?.pathname.split("/").at(4) ?? ""}` }
        : {
            title:
              URL.parse(issue.url)
                ?.pathname.split("/")
                .find((part) => /^[A-Z][A-Z0-9]*-\d+$/u.test(part)) ?? "Linear issue",
            detail: "Linear",
          }),
      url: issue.url,
    })),
    ...info.links.threads.map((thread) => ({
      group: "Threads" as const,
      title: thread.place
        ? `${channels[thread.provider].prefix}${thread.place}`
        : `${channels[thread.provider].title} thread`,
      detail: channels[thread.provider].title,
      url: thread.url,
    })),
  ]
}

const dollars = (micro: number) => (micro > 0 && micro < 10_000 ? "<$0.01" : `$${(micro / 1_000_000).toFixed(2)}`)

export const about = (info: RenRpc.Details) => ({
  started: [info.startedBy && `by ${info.startedBy}`, info.origin && origins[info.origin]].filter(Boolean).join(" · "),
  context: info.context ? `${info.context.toLocaleString("en-US")} tokens` : "",
  cost: info.cost
    ? [
        dollars(info.cost.total),
        ...(info.cost.models > 0 ? [`LLM ${dollars(info.cost.models)}`] : []),
        ...(info.cost.tools > 0 ? [`tools ${dollars(info.cost.tools)}`] : []),
      ].join(" · ")
    : "",
})

const visit = (surface: InfoSurface, url: string, title: string) => {
  if (!surface.open(url)) void surface.ui.dialog.alert({ title, message: `Open this address in your browser:\n${url}` })
}

const shownInfo = async (surface: InfoSurface) => {
  const route = surface.ui.router.current()
  if (route.type !== "session") {
    surface.ui.toast.show({ title: "Ren", message: "Open a Ren session first.", variant: "warning" })
    return
  }
  const info = await surface.client.rpc(RenRpc.Definition).sessionInfo({ sessionID: route.sessionID }, at(surface))
  if (!info.ren) surface.ui.toast.show({ title: "Ren", message: "This is not a Ren session.", variant: "warning" })
  return info.ren ? info : undefined
}

export const openWeb = (surface: InfoSurface) =>
  shownInfo(surface)
    .then((info) => {
      if (!info?.url) return
      if (!info.created)
        surface.ui.toast.show({
          title: "Ren",
          message: `This session starts on Ren with its first prompt, so its space ${info.space?.name ?? ""} opens instead.`,
          variant: "info",
        })
      visit(surface, info.url, "Open in Ren")
    })
    .catch(fail(surface))

export const links = (surface: InfoSurface) =>
  shownInfo(surface)
    .then(async (info) => {
      if (!info) return
      const rows = linkRows(info)
      if (rows.length === 0) {
        surface.ui.toast.show({
          title: "Ren",
          message: "This Ren session has no tasks, pull requests, issues or threads yet.",
          variant: "info",
        })
        return
      }
      const chosen = await surface.ui.dialog.select({
        title: "Ren session links",
        placeholder: "Filter",
        options: rows.map((row) => ({
          title: row.title,
          value: row.url,
          description: row.detail,
          category: row.group,
        })),
      })
      if (chosen) visit(surface, chosen, "Open link")
    })
    .catch(fail(surface))

export const activity = (surface: PanelSurface) => {
  const sessionID = current(surface)
  if (!sessionID) return Promise.resolve(false)
  return surface.client
    .rpc(RenRpc.Definition)
    .activity({ sessionID }, at(surface))
    .then(() => surface.ui.panel.open(panels.activity))
    .catch((error: unknown) => {
      fail(surface)(error)
      return false
    })
}

export const background = (surface: PanelSurface) => {
  const sessionID = current(surface)
  if (!sessionID) return Promise.resolve()
  return surface.client
    .rpc(RenRpc.Definition)
    .background({ sessionID }, at(surface))
    .then((result) =>
      surface.ui.toast.show(
        result.moved.length > 0
          ? {
              title: "Ren",
              message: `Moved to the background: ${result.moved.map((work) => work.label || work.type).join(", ")}. The turn goes on.`,
              variant: "success",
            }
          : { title: "Ren", message: "Nothing blocks this Ren session’s turn.", variant: "info" },
      ),
    )
    .catch(fail(surface))
}
