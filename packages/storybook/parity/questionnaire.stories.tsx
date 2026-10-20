import type { ComponentProps } from "react"
import { QuestionnaireForm } from "ren-v1/composites/questionnaire"
import meta from "../ui/questionnaire.stories.js"

export default {
  ...meta,
  component: QuestionnaireForm,
  render: function Render(args: ComponentProps<typeof QuestionnaireForm>) {
    return (
      <div className="flex w-120 flex-col gap-4">
        <QuestionnaireForm {...args} pending={args.pending ?? false} />
      </div>
    )
  },
}

export { Permission, MultiStep, LeadingAction } from "../ui/questionnaire.stories.js"
