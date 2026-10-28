# Chat

The transcript and composer are built from shadcn's chat components, fed by `@ren/chat`'s narrow values. Install them from `packages/ui` with `bunx --bun shadcn@latest add message-scroller message bubble attachment marker trace code-block`, and read each one's docs (`docs <name>`) for its props. Lint checks the structure; this file covers which part to use and how the pieces fit.

## Which part

| Content                                                              | Part                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The scrolling thread                                                 | `MessageScroller`, every row in a `MessageScrollerItem`; never a raw overflow `div` or `ScrollArea`                            |
| One turn                                                             | `Message`; `align="end"` for the person, `align="start"` for the agent. Consecutive turns from one sender go in `MessageGroup` |
| The person's message surface                                         | `Bubble` with `BubbleContent`; reactions in `BubbleReactions`                                                                  |
| Files and images                                                     | `Attachment` with `state` wired to the real upload status; several in `AttachmentGroup`                                        |
| Notes and dividers between turns ("Today", "Sarah joined")           | `Marker`, `variant="separator"` for a labelled rule                                                                            |
| What the agent did: reasoning, tool calls, steps, sources, subagents | `TraceLine` in a `Trace`                                                                                                       |
| Code, tool input and output, logs, diffs                             | `CodeBlock`                                                                                                                    |
| A permission or approval waiting for an answer                       | an `Item` with the choices in `ItemActions`, outside the `Trace`                                                               |
| The composer                                                         | `InputGroup`: a textarea, attachment chips and the submit button                                                               |
| The model picker                                                     | `DropdownMenu` with a `DropdownMenuRadioGroup`                                                                                 |

## Trace

- A line is a `TraceIcon` and a `TraceTitle`, then an optional `TraceDescription` for a count, a duration or a diff stat. State goes in `status`: `"running"`, `"error"` or `"pending"` (a step not started), or none. Its words agree: Running, Ran, Failed to run.
- Behaviour wraps the line. Nothing to open: the line alone. Expands: `TraceCollapsible` > `TraceCollapsibleTrigger` > `TraceLine`, then `TraceCollapsibleContent`; the trigger adds the chevron. A link: `<a>` > `TraceLine`. An overlay: `SheetTrigger` (or `DialogTrigger`, `PopoverTrigger`) > `TraceLine`.
- A tool row is a `TraceLine` until its output arrives, then a `TraceCollapsible`. Don't render an empty `TraceCollapsibleContent`.
- Rows from consecutive tool and reasoning parts share one `Trace`; a text part or a pending permission ends the run.
- A summary (a turn's work, a task, sources) is a `TraceCollapsible` whose content holds a nested `Trace`. Set the summary's status and title from its children.
- Add a trailing `TraceIcon` only for a link (arrow-up-right, with " (opens in a new tab)" as `sr-only` text in the title) or an overlay (chevron-right).
- Open state goes on `TraceCollapsible`: `defaultOpen`, or `open` with `onOpenChange`.

## CodeBlock

- `CodeBlockContent` takes a string. Add `wrap` for tool output and errors, `lineNumbers` for source, `startLine` for a snippet from the middle of a file, and a `max-h-*` class to cap the height.
- Output inside a trace row is `size="sm"` with `wrap` and `max-h-64`. Markdown fences and answers use the default size.
- Errors use `variant="destructive"`; don't recolour the block. Diff and highlighted lines map to `CodeBlockLine` with `variant="added"`, `"removed"` or `"highlighted"`.
- Highlight source with `useHighlightedCode(code, language)` and map its lines into `CodeBlockLine`. Pass tool output as a plain string.
- Header buttons go in `CodeBlockActions`; `CodeBlockCopyButton` takes the text as `value`. Without a header, `CodeBlockActions` sits directly in `CodeBlock` and shows on hover.

## Scrolling

- `MessageScrollerProvider autoScroll` follows a streaming reply and lets go as soon as the person scrolls up.
- `scrollAnchor` on the person's `MessageScrollerItem` holds their turn in view while the reply streams.
- `MessageScrollerButton` sits after the viewport and appears by itself when the person scrolls away.
- `defaultScrollPosition="end"` or `"last-anchor"` opens a saved transcript at that position; the viewport stays hidden until it is applied.
- For anything the parts don't expose, read `useMessageScroller`, `useMessageScrollerVisibility` or `useMessageScrollerScrollable` instead of measuring the DOM.
- A "thinking" label uses the `shimmer` utility.
