---
name: ren-design
description: Use for Ren Design, the Figma file that mirrors Ren's app: a screenshot of a Ren screen, alternatives for a change people see, or syncing the file with main.
---

# Ren Design

https://www.figma.com/design/4lMuhFC3GmZuQ5PKaUk0y3/Ren-Design. Code is the source of truth; the file
follows `main`. Use the Figma app's skills for Figma itself, and the `interface` skill for what a
screen should do.

## Rules

- Match the file. Read a SCREENS page and Read me before you draw.
- Instances of COMPONENTS and Theme variables only. No raw colours. No text on the canvas except
  `Work note` instances.
- A paint bound to a variable needs the variable's dark value as its fallback, or black shows.
- Instances drop paint opacity on a bound colour: use a `<variable>-<percent>` variable.
- An icon swapped through an instance-swap property keeps its colour: recolour it.

## Screenshot

`get_screenshot` the frame on its SCREENS page, and link the frame.

## Capture

Start the app with `packages/e2e/script/serve.ts` and make a user with
`packages/e2e/script/e2e-user.ts`. Viewport 1440×1024. Per page: get a capture id from
`generate_figma_design`, `agent-browser eval` `https://mcp.figma.com/mcp/html-to-design/capture.js`,
call `window.figma.captureForDesign({ captureId, endpoint, selector: 'body' })` without awaiting it,
then poll the tool. Never edit `index.html`.

## Propose

On the issue's page under EXPLORATIONS, `↪ WIP: #<number> <title>`, indented like the others. Clone
the SCREENS frames the change touches as the base, and delete the base frames at the end. Make two or
three alternatives, one section each, `a — …`, `b — …`, with a `Work note` above it: what changes,
pro, con. Frames are 1440×1024 and show each state the change touches: default, hover, open, empty,
success. Draw a part Ren does not have on the WIP page, named as code would name it; the change adds
it to code and Sync brings it to Patterns. Never change SCREENS, COMPONENTS or TOKENS here.
Screenshot each section.

## Sync

One sync at a time.

1. The `Sync log` note on Read me has the commit each area (TOKENS, COMPONENTS, each SCREENS page)
   was last synced to.
2. In a worktree at `origin/main`, per area: `git log --name-only <commit>..origin/main --
   packages/ui packages/app/src`. Nothing changed: stop.
3. Capture the changed screens. Update in place: tokens, then components, then screens. Compare
   each changed frame with its capture.
4. Write the new commits in the log. Move the `WIP:` pages of merged issues to Archive.

An area whose `git log` lists more than 30 commits, or a removed token or component, needs a person:
report it and leave the log.
