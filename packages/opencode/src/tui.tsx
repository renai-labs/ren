import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, on, Show, untrack } from "solid-js"
import { RenCommands } from "./commands.js"
import { RenRpc } from "./rpc.js"
import { Support } from "./support.js"

export default Plugin.define({
  id: "ren",
  setup(context) {
    const refused = Support.refusal(context.app)
    if (refused) {
      context.ui.toast.show({ title: "Ren", message: refused, variant: "warning" })
      return
    }
    const surface = {
      client: context.client,
      location: () => context.location ?? context.data.location.default(),
      ui: context.ui,
      reload: async (sessionID: string, load: () => Promise<unknown>) => {
        const created = Promise.withResolvers<void>()
        const stop = context.data.on("session.created", (event) => {
          if (event.data.sessionID === sessionID) created.resolve()
        })
        const timer = setTimeout(created.resolve, 3000)
        void created.promise.then(() => {
          stop()
          clearTimeout(timer)
        })
        await load()
        await created.promise
        context.data.session.message.invalidate(sessionID)
        await context.data.session.message.sync(sessionID)
      },
      open: (url: string) => {
        const opener = process.platform === "darwin" ? "open" : "xdg-open"
        if (Bun.which(opener)) Bun.spawn([opener, url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref()
      },
    }
    const [space, setSpace] = createSignal<RenRpc.SpaceInfo>()
    const load = () => {
      void RenCommands.selected(surface).then((selected) => setSpace(selected))
    }
    load()
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "ren.space",
          title: "Select a Ren space",
          group: "Ren",
          palette: true,
          slash: { name: "ren:space" },
          run: () => RenCommands.space(surface),
        },
        {
          id: "ren.new",
          title: "New Ren session",
          description: "A session in the selected Ren space, on a Ren model",
          group: "Ren",
          palette: true,
          slash: { name: "ren:new" },
          run: () => RenCommands.create(surface),
        },
        {
          id: "ren.login",
          title: "Sign in to Ren",
          group: "Ren",
          palette: true,
          slash: { name: "ren:login" },
          run: () => RenCommands.login(surface),
        },
        {
          id: "ren.logout",
          title: "Sign out of Ren",
          group: "Ren",
          palette: true,
          slash: { name: "ren:logout" },
          run: () => RenCommands.logout(surface),
        },
        {
          id: "ren.move",
          title: "Move session to Ren",
          description: "This session, with its history, into the selected Ren space",
          group: "Ren",
          palette: true,
          slash: { name: "ren:move" },
          run: () => RenCommands.move(surface),
        },
        {
          id: "ren.sessions",
          title: "Open a Ren session",
          description: "Sessions in the selected Ren space, also those started elsewhere",
          group: "Ren",
          palette: true,
          slash: { name: "ren:sessions" },
          run: () => RenCommands.sessions(surface),
        },
        {
          id: "ren.retry",
          title: "Retry the Ren session",
          description: "Start a failed or stopped Ren session again, or send its failed last message again",
          group: "Ren",
          palette: true,
          slash: { name: "ren:retry" },
          run: () => {
            const route = context.ui.router.current()
            const sessionID = route.type === "session" ? route.sessionID : undefined
            return RenCommands.retry(surface, {
              ...(sessionID && { sessionID }),
              running: sessionID ? context.data.session.status(sessionID) === "running" : false,
            })
          },
        },
      ],
    }))
    const catching = new Set<string>()
    createEffect(
      on(
        () => {
          const route = context.ui.router.current()
          if (route.type !== "session" || !context.data.session.get(route.sessionID)?.metadata?.["ren"]) return
          return context.data.session.status(route.sessionID) === "idle" ? route.sessionID : undefined
        },
        (sessionID) => {
          if (!sessionID || catching.has(sessionID)) return
          catching.add(sessionID)
          void RenCommands.catchUp(surface, sessionID).finally(() => catching.delete(sessionID))
        },
      ),
    )
    const status = () => (
      <Show when={space()}>
        <box flexShrink={0}>
          <text fg={context.theme.text.muted} wrapMode="none">
            ren · {space()?.name}
          </text>
        </box>
      </Show>
    )
    const [statuses, setStatuses] = createSignal<ReadonlyMap<string, RenRpc.SessionStatus>>(new Map())
    const [now, setNow] = createSignal(Date.now())
    const keep = (found: RenRpc.SessionStatus | undefined) => {
      if (found) setStatuses((current) => new Map(current).set(found.sessionID, found))
    }
    const reload = (sessionID: string) => {
      void RenCommands.sessionStatus(surface, sessionID).then(keep)
    }
    const reloadAll = () => {
      for (const sessionID of statuses().keys()) reload(sessionID)
    }
    const ticker = setInterval(() => {
      if ([...statuses().values()].some((found) => found.state === "reconnecting")) setNow(Date.now())
    }, 1_000)
    const sessionStatus = (input: { readonly sessionID?: string }) => {
      createEffect(() => {
        const sessionID = input.sessionID
        if (sessionID && !untrack(statuses).has(sessionID)) reload(sessionID)
      })
      const described = () => {
        const sessionID = input.sessionID
        const found = sessionID ? statuses().get(sessionID) : undefined
        return sessionID && found?.ren
          ? RenCommands.describe(found, { now: now(), running: context.data.session.status(sessionID) === "running" })
          : undefined
      }
      return (
        <Show when={described()} fallback={status()}>
          {(text) => (
            <box flexShrink={0}>
              <text fg={context.theme.text.muted} wrapMode="none">
                {text()}
              </text>
            </box>
          )}
        </Show>
      )
    }
    const stops = [
      context.ui.slot({ append: "home.footer.status", render: status }),
      context.ui.slot({ append: "prompt.footer.status", render: sessionStatus }),
      context.client.rpc(RenRpc.Definition).events.on("statusChanged", (event) => keep(event.data)),
      context.client.rpc(RenRpc.Definition).events.on("signedIn", reloadAll),
      context.client.rpc(RenRpc.Definition).events.on("signedOut", reloadAll),
      context.data.on("server.connected", reloadAll),
      context.data.on("session.execution.succeeded", (event) => {
        if (statuses().has(event.data.sessionID)) reload(event.data.sessionID)
      }),
      context.data.on("session.execution.failed", (event) => {
        if (statuses().has(event.data.sessionID)) reload(event.data.sessionID)
      }),
      () => clearInterval(ticker),
      context.client.rpc(RenRpc.Definition).events.on("spaceSelected", (event) => {
        setSpace(event.data)
      }),
      context.data.on("server.connected", load),
      context.client.rpc(RenRpc.Definition).events.on("signedIn", load),
      context.client.rpc(RenRpc.Definition).events.on("signedOut", () => setSpace(undefined)),
    ]
    const requests = RenCommands.requests(surface)
    stops.push(context.data.on("server.connected", () => void RenCommands.syncRequests(surface)))
    return () => {
      for (const stop of stops) stop()
      void requests.then((stop) => stop())
    }
  },
})
