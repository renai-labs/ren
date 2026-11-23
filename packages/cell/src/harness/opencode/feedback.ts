export * as OpenCodeFeedback from "./feedback.js"

export const name = "feedback"

export const description = "send feedback to the Ren team"

export const instruction = (text: string) =>
  [
    "The person ran /feedback to send feedback about Ren to the Ren team. Send it now with Ren’s feedback_report tool, then tell them in one short sentence that the team has it.",
    "",
    "- The message is their feedback below, in their words. Fix only typos. Add what this chat shows only when the team needs it to understand, such as an error you saw.",
    "- When they wrote nothing, ask them what they want to tell the team, and send it after they answer.",
    "",
    "<feedback>",
    text,
    "</feedback>",
  ].join("\n")
