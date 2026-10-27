---
name: interface
description: Use when designing or reviewing screens, layouts, motion, accessibility or interface copy in packages/app.
---

# Interface in Ren

Run `bun run check` and follow each message. This skill covers the judgment calls. The app is built from shadcn components with Ren's theme (`packages/app/src/index.css`); the rules for components, variants and overrides are in `packages/app/AGENTS.md` and `packages/app/VARIANTS.md`.

- Components: use the `shadcn` skill. Check shadcn's registry and docs (`shadcn docs`, `shadcn search`) before writing a component, and keep shadcn's API.
- Polish and motion: use the `emil-design-eng` skill, and review each page or chat pattern with it before calling it done.

## Layout

When porting a screen or component, inspect its source and feature usage before editing. Preserve its appearance, interactions and states unless a change is approved. Verify it in the running app (`bun run dev:app`) against the local API; report parity as verified only after that check runs.

- Nothing that stays on screen moves when a page, tab or list page changes. The dev build logs any layout shift to the console; fix it.

- Group with space before lines. The gap between groups is at least twice the gap inside one.
- Give each view one primary action. Move secondary actions into a menu once there are more than three.
- Make controls look interactive: a fill, a border or a consistent toolbar position, never styled like the text beside them.
- Put identifying content first in a row, metadata and actions last.
- Every hidden or truncated value needs a way to reach it: a disclosure, a detail view, or a tooltip that is also keyboard-reachable.
- Size text containers with `min-h-*` and `max-w-*`, never a fixed height, and let rows wrap.

## Motion

- Interactions that happen often (typing, row hover, tab switches, keyboard actions) get no animation beyond a colour or opacity transition.
- Animate only `transform` and `opacity`, under 300ms, with `ease-out`; exits faster than entries. Respect `prefers-reduced-motion`.
- Reserve expressive motion for rare moments: first load, success, empty states.
- Every animated change also leaves a static cue (colour, icon or label). Motion is never the only feedback.

## Accessibility

- Visible label text appears at the start of the accessible name.
- Status never relies on colour alone. Pair it with an icon or text.
- Validate on submit. Mark failing fields invalid, describe the error next to the field and focus the first one.
- Toasts that carry an action or an error stay until dismissed.
- Every drag interaction has a button or menu that does the same thing.

## Copy

- Use one word per object and one verb per action across the product. Before naming something, search for how existing copy names it.
- Buttons start with a verb and name the object: “Save draft”, “Delete project”.
- Errors say what failed and how to fix it, next to where it failed. No blame and no exclamation marks.
- Prefer undo over confirmation for reversible actions. Confirm only irreversible, shared or bulk actions; the title names the action and the object, and the body states what is lost.
- Empty states say what the place is for and offer one next action. A filtered empty state names the filter and offers to clear it.
- Toggle labels describe the on state: “Send read receipts”, not “Don’t send read receipts”.
- Placeholders show an example of the format, never an instruction.
- Use sentence case everywhere.
