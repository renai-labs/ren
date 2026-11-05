export * as SlackGuides from "./slack-guides.js"

export interface Guide {
  readonly uri: string
  readonly name: string
  readonly description: string
  readonly text: string
}

const messaging: Guide = {
  uri: "slack://guides/messaging",
  name: "Writing Slack messages",
  description: "How Ren writes, structures and places a Slack message: format, threads, tone, files and scheduling.",
  text: `# Writing Slack messages

## Format

Write standard Markdown; Ren converts it for Slack. Never write Slack mrkdwn: *bold* and ~strike~ mean something else in Markdown.

| Format | Syntax |
| --- | --- |
| Bold | **text** |
| Italic | _text_ |
| Strikethrough | ~~text~~ |
| Inline code | \`code\` |
| Quote | > text |
| Link | [text](https://example.com) |
| Lists | - item, 1. item |
| Headers | ## Section |

Code blocks take a language (\`\`\`python) for highlighting. Tables use | between columns; escape a literal | inside a cell as \\|. An image (![alt](url)) shows as a link, not an image: send the image as a file instead.

## Structure

- Put the answer in the first line. Notifications and mobile show only the first line.
- Keep it short: one to three short paragraphs. Put a long report, a table of many rows or a document in a file, shown with show_file; the answer posts it to the thread.
- Leave blank lines between ideas. Write three or more items as a list.
- Bold the names, dates, deadlines and actions that a reader scans for.
- Put a numeric comparison in charts, at most 2 per message: Ren posts each as a native Slack chart.

## Threads and channels

- Answer in the thread that started the chat: slack_send_message without channel_id.
- Post in another channel or DM only when the person asked for it.
- Reply in an existing thread rather than starting a new one about the same thing.
- Set reply_broadcast only when everyone in the channel needs the reply.
- Do not mention @channel or @here unless the person asked for it.
- For a plain acknowledgment, add a reaction with slack_add_reaction instead of a reply.

## Tone and sources

- Match the channel: an announcement channel is more formal than a social one.
- For an announcement: the context, the key facts, then what to do.
- When the answer rests on Slack messages or files, link them: search results carry permalinks, and slack_send_message returns message_link.

## Scheduling

slack_schedule_message takes post_at as a Unix timestamp, at least 2 minutes and at most 120 days ahead. Read the person’s time zone with slack_read_user_profile first. A scheduled message cannot be edited afterwards; people manage it from Drafts & sent in Slack.
`,
}

const search: Guide = {
  uri: "slack://guides/search",
  name: "Searching Slack",
  description: "How Ren searches Slack messages, files, channels and people, and reads results in context.",
  text: `# Searching Slack

## Tools

| Tool | Finds |
| --- | --- |
| slack_search_public | Messages and files in public channels, as the person whose message started the chat |
| slack_search_channels | Channels by name, topic or purpose |
| slack_search_users | People by name, email or title |
| slack_search_emojis | Custom emoji by name |

slack_search_public works only in a chat that a Slack mention or DM started, shortly after that message. Slack allows about 10 searches a minute per person: plan a few precise searches, not many broad ones.

## Strategy

1. Start with a simple keyword or a question.
2. Too many results: add modifiers. Too few: drop modifiers and try other words.
3. Split a complex question into small searches: the topic, then a person’s messages, then a channel.

A question (it starts with what, how or who, or ends with ?) searches by meaning on plans with Slack AI search. Keywords match exact words, with stemming; space-separated words must all match.

## Modifiers

- Where: in:#channel or in:<#C123>, -in:#channel, in:<@U123> for a DM
- Who: from:<@U123> or from:username, to:<@U123>, creator:<@U123> for canvases
- What: is:thread, is:saved, has:pin, has:link, has:file, has::emoji:
- When: before:YYYY-MM-DD, after:YYYY-MM-DD, on:YYYY-MM-DD, during:month
- Text: "exact phrase", -word, wild* (3 letters at least)

Repeating a modifier ORs its values. AND, OR, NOT and parentheses do not work as operators.

## Files

Set content_types to files and add a type: filter: images, documents, pdfs, spreadsheets, presentations, canvases, lists, emails, audio or videos. The other modifiers work too.

## After a search

- A message in a thread: slack_read_thread with its channel_id and thread_ts.
- The messages around a result: slack_read_channel with latest and oldest.
- A file: slack_read_file with its ID.
- A person: slack_read_user_profile with their user ID.
- Search lags a few seconds behind Slack. For the newest messages, read the channel.
`,
}

const canvas: Guide = {
  uri: "slack://guides/canvas",
  name: "Writing Slack canvases",
  description: "The Markdown dialect of Slack canvases, and how Ren creates, reads and edits them.",
  text: `# Writing Slack canvases

A canvas is a Slack document. Ren’s bot owns each canvas it creates and shares it, with edit access, with a channel. Return the canvas link to the person. Canvases need a paid Slack plan.

## Canvas Markdown

Canvases use their own Markdown, richer than messages:

- Headings #, ## and ### only. Do not repeat the title in the content.
- Lists, checklists (- [ ] and - [x]), tables, links, code blocks, quotes and dividers (---, top level only).
- Mention a user as ![](@U123ABC) and a channel as ![](#C123ABC), always by ID. Never write <@U…> or <#C…>. A mention on its own line shows as a card.
- A date as ![](slack_date:2025-12-16), with no day name or date text after it.
- An image on its own top-level line: ![alt](https://example.com/image.png). A Slack file: ![](https://acme.slack.com/files/U123/F456/report.pdf).
- A callout: a line ::: {.callout}, the text, then a line :::. Callouts hold no tables and do not nest.
- Up to 3 columns: ::: {.layout}, then each column as ::: {.column} … :::, then :::. Layouts hold no tables or callouts.
- Link only http, https, mailto, tel, ftp and slack URLs.

## Nesting

- A list item holds only text with inline formatting: no code blocks, quotes or headings.
- Put code blocks, quotes and headings outside lists, with blank lines around them.
- Do not mix numbered and bulleted items in one nested list.
- A table cell can break lines with <br>.

## Editing

1. Read the canvas with slack_read_canvas: its Markdown and the section ID of each heading.
2. Call slack_update_canvas:
   - append without section_id: add to the end
   - prepend without section_id: add at the start
   - append or prepend with section_id: add right after or right before that section
   - replace with section_id: change only that section
   - replace without section_id: OVERWRITES THE WHOLE CANVAS. Do it only when the person asked for it.
`,
}

export const guides: ReadonlyArray<Guide> = [messaging, search, canvas]
