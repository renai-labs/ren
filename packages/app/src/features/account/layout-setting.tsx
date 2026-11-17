import { Button } from "@ren/ui/button"
import { AppearancePreferences } from "../../lib/appearance-preferences.js"
import { Preference } from "../../lib/preference.js"

const cards = [
  { value: "sidebar", label: "Sidebar" },
  { value: "tabs", label: "Tabs" },
] as const

const bar = "h-1 rounded-full bg-neutral-700"

// oxlint-disable-next-line ren/no-comments -- A small drawing of the layout: the sidebar and the page, with a row of tabs above the page for Tabs.
function Preview(props: { tabs: boolean }) {
  return (
    <span className="flex flex-1 gap-2 bg-neutral-900 p-3">
      <span className="flex w-1/4 flex-col gap-1.5 pt-0.5">
        <span className="h-1.5 w-3/4 rounded-full bg-neutral-500" />
        <span className={bar} />
        <span className={bar} />
        <span className={bar} />
      </span>
      <span className="flex flex-1 flex-col gap-1.5">
        {props.tabs ? (
          <span className="flex gap-1">
            <span className="h-2 w-1/4 rounded-sm bg-neutral-600" />
            <span className="h-2 w-1/4 rounded-sm bg-neutral-800" />
            <span className="h-2 w-1/4 rounded-sm bg-neutral-800" />
          </span>
        ) : null}
        <span className="flex flex-1 flex-col gap-1.5 rounded-md bg-neutral-800 p-2">
          <span className="h-1 w-2/3 rounded-full bg-neutral-600" />
          <span className="h-1 w-1/2 rounded-full bg-neutral-700" />
          <span className="mt-auto h-2.5 rounded-sm bg-neutral-700" />
        </span>
      </span>
    </span>
  )
}

// oxlint-disable-next-line ren/no-comments -- Laid out as the theme setting: picture cards under the setting's name.
export function LayoutSetting() {
  const layout = Preference.usePreference(AppearancePreferences.layout)
  const setPreference = Preference.useSetPreference()
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <span className="text-sm font-medium">Interface layout</span>
      <div role="radiogroup" aria-label="Interface layout" className="grid grid-cols-2 gap-2">
        {cards.map((card) => (
          <Button
            key={card.value}
            variant="ghost"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a preview card is the radio, as the theme cards are
            role="radio"
            aria-checked={layout === card.value}
            onClick={() => setPreference(AppearancePreferences.layout, card.value)}
            className="group h-auto flex-col items-center gap-2 p-0 font-normal text-muted-foreground hover:bg-transparent active:not-aria-[haspopup]:scale-100 aria-checked:font-medium aria-checked:text-foreground"
          >
            <span className="flex h-32 w-full overflow-hidden rounded-lg border group-aria-checked:ring-2 group-aria-checked:ring-foreground">
              <Preview tabs={card.value === "tabs"} />
            </span>
            {card.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
