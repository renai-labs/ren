import { Plugin } from "@opencode/plugin/tui"
import { createSignal, Show } from "solid-js"
import { RenCommands } from "./commands.js"
import { RenRpc } from "./rpc.js"

export default Plugin.define({
  id: "ren",
  setup(context) {
    const surface = {
      client: context.client,
      location: () => context.location ?? context.data.location.default(),
      ui: context.ui,
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
      ],
    }))
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
    return () => {
      for (const stop of stops) stop()
    }
  },
})
