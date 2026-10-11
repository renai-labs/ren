import type { Decorator, Meta, StoryObj } from "@storybook/react-vite"
import { useEffect } from "react"
import { Button } from "./button.js"
import { Toast } from "./toast.js"
import type { ToastType } from "./toast.js"

type Shown = { type?: ToastType; title: string; description?: string; action?: string }

function Show(props: Shown) {
  useEffect(() => {
    Toast.manager.add({
      id: "story",
      timeout: 0,
      type: props.type,
      title: props.title,
      description: props.description,
      actionProps: props.action === undefined ? undefined : { children: props.action },
    })
    return () => Toast.manager.close("story")
  }, [props.type, props.title, props.description, props.action])
  return null
}

const showing =
  (toast: Shown): Decorator =>
  (Story) => (
    <>
      <Toast.Provider>
        <div className="min-h-dvh">
          <Story />
        </div>
      </Toast.Provider>
      <Show {...toast} />
    </>
  )

const meta = {
  title: "UI/Toast",
  component: Toast.Region,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Toast.Region>

export default meta

type Story = StoryObj<typeof meta>

const saved = showing({ type: "success", title: "Changes saved", description: "Your profile is up to date." })

export const Success: Story = { decorators: [saved] }
export const Danger: Story = {
  decorators: [
    showing({ type: "error", title: "Unable to save changes", description: "Check your connection and try again." }),
  ],
}
export const Warning: Story = {
  decorators: [showing({ type: "warning", title: "Storage almost full", description: "Remove unused files." })],
}
export const Info: Story = {
  decorators: [showing({ type: "info", title: "New version available" })],
}
export const Loading: Story = {
  decorators: [showing({ type: "loading", title: "Uploading files" })],
}
export const Plain: Story = {
  decorators: [showing({ title: "Link copied" })],
}
export const WithAction: Story = {
  decorators: [
    showing({ type: "error", title: "Unable to save changes", description: "Check your connection.", action: "Retry" }),
  ],
}
export const HiddenCloseButton: Story = { args: { closeButton: "hidden" }, decorators: [saved] }
export const TopCenter: Story = { args: { placement: "top-center" }, decorators: [saved] }
export const Interactive: Story = {
  decorators: [
    (Story) => (
      <Toast.Provider>
        <div className="min-h-dvh p-4">
          <Button onClick={() => Toast.manager.add({ type: "success", title: "Changes saved" })}>Save changes</Button>
          <Story />
        </div>
      </Toast.Provider>
    ),
  ],
}
