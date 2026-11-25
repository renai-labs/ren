import { describe, expect, test } from "bun:test"
import { Composer } from "../src/composer.js"
import { ComposerTokens } from "../src/composer-tokens.js"
import { Mentions } from "../src/mentions.js"

const general = Mentions.fromAgent({ id: "general", name: "General", mode: "subagent", hidden: false })
const plan = Mentions.fromFile({ path: "docs/plan.md", type: "file" })

describe("ComposerTokens", () => {
  test("splits a draft's text into text and tokens around the mentions it knows", () => {
    const text = "Ask @  General to read @  docs/plan.md now"
    const found = Mentions.tokens(text, [general, plan])
    expect(ComposerTokens.toValue(text, found)).toEqual([
      "Ask ",
      ComposerTokens.fromItem(general),
      " to read ",
      ComposerTokens.fromItem(plan),
      " now",
    ])
  })

  test("writes tokens back as the draft's mention text and records where each one was picked", () => {
    const draft = ComposerTokens.toDraft(Composer.empty, ["Ask ", ComposerTokens.fromItem(general), " today"])
    expect(draft.text).toBe("Ask @  General today")
    expect(draft.picked).toEqual([{ start: 4, end: 14, item: general }])
    expect(Mentions.resolve(draft.text, Mentions.tokens(draft.text, [], draft.picked)).text).toBe("Ask @general today")
  })

  test("round-trips a draft through the token value without changing its text", () => {
    const text = "@  General, then @  docs/plan.md and @  unknown"
    const found = Mentions.tokens(text, [general, plan])
    expect(ComposerTokens.textOf(ComposerTokens.toValue(text, found))).toBe(text)
  })

  test("drops picked tokens from a draft once its value has none", () => {
    const draft = { ...Composer.empty, text: "@  General", picked: [{ start: 0, end: 10, item: general }] }
    expect(ComposerTokens.toDraft(draft, ["plain"])).toEqual({ ...Composer.empty, text: "plain" })
  })

  test("writes a token it can't read as its label", () => {
    expect(ComposerTokens.textOf(["Hi ", { type: "mention", value: "ada", label: "Ada" }])).toBe("Hi Ada")
  })

  test("counts each token as one caret offset", () => {
    expect(ComposerTokens.length(["Ask ", ComposerTokens.fromItem(general), " now"])).toBe(9)
  })
})
