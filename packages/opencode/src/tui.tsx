import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, on, Show } from "solid-js"
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
    const stops = [
      context.ui.slot({ append: "home.footer.status", render: status }),
      context.ui.slot({ append: "prompt.footer.status", render: status }),
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
