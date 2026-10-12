import "./preview.css"

import type { Preview } from "@storybook/react-vite"
import { Theme } from "@ren/ui/theme"

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: { title: "Theme", icon: "paintbrush", items: ["dark", "light", "girliepop"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "dark" },
  parameters: { layout: "padded" },
  decorators: [
    (Story, context) =>
      context.parameters["theme"] === "story" ? (
        <Story />
      ) : (
        <Theme.Provider
          preference={Theme.preferences.find((preference) => preference === context.globals["theme"]) ?? "dark"}
          onPreferenceChange={() => undefined}
        >
          <Story />
        </Theme.Provider>
      ),
  ],
}

export default preview
