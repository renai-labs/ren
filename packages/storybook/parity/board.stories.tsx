import { Board } from "ren-v1/composites/board"
import meta from "../ui/board.stories.js"
import { Populated } from "../ui/board.stories.js"
import { Text } from "@ren/ui/text"
import type { StoryObj } from "@storybook/react-vite"

export default { ...meta, component: Board.Card }

export { WithoutTurn, Populated } from "../ui/board.stories.js"

export const PopulatedColumns: StoryObj<typeof meta> = {
  ...Populated,
  decorators: [
    (Story) => (
      <div className="flex h-120 w-full">
        <Board label="Task board">
          <Board.Column
            label="Plan"
            header={
              <Text purpose="label" element="h2">
                Plan
              </Text>
            }
          >
            <Story />
          </Board.Column>
          <Board.Column
            label="Build"
            header={
              <Text purpose="label" element="h2">
                Build
              </Text>
            }
          />
        </Board>
      </div>
    ),
  ],
}
