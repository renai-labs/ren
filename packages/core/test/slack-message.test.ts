import { describe, expect, test } from "bun:test"
import { SlackMessage } from "../src/channel-provider/slack-message.js"

const rich = (...elements: ReadonlyArray<object>) => [{ type: "rich_text", elements }]

const section = (...elements: ReadonlyArray<object>) => ({ type: "rich_text_section", elements })

const cases: ReadonlyArray<readonly [string, SlackMessage.Raw, string]> = [
  [
    "Ren's own mention goes, other people and channels stay for the names",
    { text: "<@UBOT> ping <@UALICE> see <#C999> and <#C1|general>" },
    "ping <@UALICE> see <#C999> and #general",
  ],
  [
    "a labelled link becomes Markdown",
    { text: "see <https://ren.dev/docs|the docs>" },
    "see [the docs](https://ren.dev/docs)",
  ],
  ["a bare link becomes its address", { text: "see <https://ren.dev/docs>" }, "see https://ren.dev/docs"],
  ["a mailto link becomes the address", { text: "ping <mailto:a@b.com|a@b.com>" }, "ping a@b.com"],
  ["@here and a user group render as text", { text: "<!here> <!subteam^S1|@eng> ship it" }, "@here @eng ship it"],
  ["entities unescape after the tokens", { text: "a &amp; b, 1 &lt; 2 &gt; 0" }, "a & b, 1 < 2 > 0"],
  [
    "mrkdwn in section blocks decodes Slack tokens and entities",
    {
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "<@UBOT> see <https://example.com|docs> &amp; <#C1|general>" },
        },
      ],
    },
    "see [docs](https://example.com) & #general",
  ],
  [
    "rich text code keeps literal Slack tokens and entities",
    { blocks: rich(section({ type: "text", text: "<@UBOT> &amp;", style: { code: true } })) },
    "`<@UBOT> &amp;`",
  ],
  [
    "code stays as written",
    { text: "run `bun test` then:\n```\nconst x = a &amp;&amp; b &lt; c\n```" },
    "run `bun test` then:\n```\nconst x = a && b < c\n```",
  ],
  [
    "rich text keeps styles, links, lists, quotes and fenced code with its language",
    {
      text: "fallback",
      blocks: rich(
        section(
          { type: "user", user_id: "UBOT" },
          { type: "text", text: " Here is " },
          { type: "text", text: "bold", style: { bold: true } },
          { type: "text", text: " and a " },
          { type: "link", url: "https://ren.dev", text: "link" },
          { type: "text", text: " for " },
          { type: "user", user_id: "UALICE" },
        ),
        {
          type: "rich_text_list",
          style: "ordered",
          indent: 1,
          elements: [section({ type: "text", text: "first" }), section({ type: "text", text: "second" })],
        },
        { type: "rich_text_quote", elements: [{ type: "text", text: "a quote" }] },
        { type: "rich_text_preformatted", language: "ts", elements: [{ type: "text", text: "const x = 1" }] },
      ),
    },
    "Here is **bold** and a [link](https://ren.dev) for <@UALICE>\n  1. first\n  2. second\n> a quote\n```ts\nconst x = 1\n```",
  ],
  [
    "emoji, dates, user groups and broadcasts render as text",
    {
      blocks: rich(
        section(
          { type: "emoji", name: "tada", unicode: "1f389" },
          { type: "text", text: " " },
          { type: "emoji", name: "shipit" },
          { type: "text", text: " " },
          { type: "date", timestamp: 1712345678, fallback: "April 5th" },
          { type: "text", text: " " },
          { type: "usergroup", usergroup_id: "S1" },
          { type: "text", text: " " },
          { type: "broadcast", range: "channel" },
        ),
      ),
    },
    "🎉 :shipit: April 5th @group @channel",
  ],
  [
    "section, markdown and image blocks give their text",
    {
      blocks: [
        { type: "markdown", text: "**Lots of info**" },
        { type: "section", text: { type: "mrkdwn", text: "PR merged" } },
        { type: "image", title: { type: "plain_text", text: "chart" }, alt_text: "a chart" },
      ],
    },
    "**Lots of info**\nPR merged\nchart\na chart",
  ],
  [
    "a forward folds into an indented block with its source and files",
    {
      text: "take a look",
      attachments: [
        {
          author_name: "Dave",
          channel_name: "incidents",
          is_share: true,
          text: "DB at 95% disk",
          files: [{ id: "F1", name: "trace.log", mimetype: "text/plain", url_private_download: "https://x/trace" }],
        },
      ],
    },
    "take a look\n\n↳ forwarded message from Dave in #incidents:\n  DB at 95% disk\n  [file: trace.log (text/plain)]",
  ],
  [
    "a forwarded rich message reads its blocks from message_blocks",
    {
      attachments: [
        {
          is_share: true,
          author_name: "Dana",
          message_blocks: [{ message: { blocks: rich(section({ type: "text", text: "shipped it" })) } }],
        },
      ],
    },
    "↳ forwarded message from Dana:\n  shipped it",
  ],
  [
    "an unfurl with only an image shows its address",
    { attachments: [{ service_name: "imgur", image_url: "https://i.imgur.com/x.png" }] },
    "↳ link via imgur:\n  [image] https://i.imgur.com/x.png",
  ],
  [
    "files become lines, once per file id",
    {
      text: "logs",
      files: [{ id: "F1", name: "a.log", mimetype: "text/plain" }],
      attachments: [{ is_share: true, files: [{ id: "F1", name: "a.log", mimetype: "text/plain" }] }],
    },
    "logs\n\n↳ forwarded message:\n  [file: a.log (text/plain)]",
  ],
]

describe("SlackMessage", () => {
  test.each(cases)("%s", (_, message, text) => {
    expect(SlackMessage.parse(message, "UBOT").text).toBe(text)
  })

  test("the files of a message and its forwards are references, once per file id, with their download address", () => {
    expect(
      SlackMessage.parse(
        {
          files: [{ id: "F0", name: "own.png", mimetype: "image/png", size: 10, url_private_download: "https://f/0" }],
          attachments: [
            {
              is_share: true,
              files: [
                { id: "F0", name: "own.png", mimetype: "image/png", url_private_download: "https://f/0" },
                { id: "F1", title: "fwd", url_private: "https://f/1" },
              ],
            },
          ],
        },
        "UBOT",
      ).files,
    ).toEqual([
      { url: "https://f/0", name: "own.png", mime: "image/png", size: 10 },
      { url: "https://f/1", name: "fwd", mime: "application/octet-stream" },
    ])
  })

  test("the names pass replaces the people and channels it knows, and leaves the rest as ids", () => {
    const text = "ping <@UALICE> and <@UBOB> in <#C999>"
    expect(SlackMessage.references(text)).toEqual({ users: ["UALICE", "UBOB"], channels: ["C999"] })
    expect(SlackMessage.named(text, new Map([["UALICE", "Alice"]]), new Map([["C999", "incidents"]]))).toBe(
      "ping @Alice and @UBOB in #incidents",
    )
  })
})
