import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"
import { Markdown } from "../../components/markdown.js"
import { Row, Rows, Section } from "../../components/page.js"
import { Choice } from "../../components/settings-shared.js"
import { AppearancePreferences } from "../../lib/appearance-preferences.js"
import { useAppearance } from "../../lib/use-appearance.js"

const preview = "Updated `forecast.ts` to read the new column.\n\n```ts\nconst total = rows.length\n```"

export function TypographySection() {
  const appearance = useAppearance()
  return (
    <Section title="Typography">
      <Rows>
        {[
          <Row key="preview" title="Preview">
            <div className="flex w-full flex-col gap-3">
              <div className="rounded-lg border bg-background p-3">
                <Markdown className="text-sm leading-relaxed">{preview}</Markdown>
                <p className="font-mono text-(length:--ren-code-terminal-size)/5">$ bun run test</p>
              </div>
              <Button variant="outline" size="sm" className="self-end" onClick={appearance.reset}>
                Reset to defaults
              </Button>
            </div>
          </Row>,
          <Row key="ui-font" title="Interface font" description="Empty uses the default.">
            <Input
              aria-label="Interface font"
              className="w-60"
              placeholder="SF Pro"
              value={appearance.uiFont}
              onChange={(event) => appearance.setUiFont(event.target.value)}
            />
          </Row>,
          <Row key="ui-size" title="Interface size">
            <Choice
              label="Interface size"
              options={AppearancePreferences.uiSizes.map((option) => ({
                value: String(option.size),
                label: option.label,
              }))}
              value={String(appearance.uiSize)}
              onChange={(value) => {
                const option = AppearancePreferences.uiSizes.find((item) => String(item.size) === value)
                if (option) appearance.setUiSize(option.size)
              }}
            />
          </Row>,
          <Row key="code-font" title="Code font" description="Code blocks, inline code, diffs, files, Terminal.">
            <Input
              aria-label="Code font"
              className="w-60"
              placeholder="IBM Plex Mono"
              value={appearance.codeFont}
              onChange={(event) => appearance.setCodeFont(event.target.value)}
            />
          </Row>,
          <Row key="code-size" title="Code size" description="Percent of each surface’s size.">
            <Choice
              label="Code size"
              options={AppearancePreferences.codeSizes.map((option) => ({
                value: String(option.size),
                label: option.label,
              }))}
              value={String(appearance.codeSize)}
              onChange={(value) => {
                const option = AppearancePreferences.codeSizes.find((item) => String(item.size) === value)
                if (option) appearance.setCodeSize(option.size)
              }}
            />
          </Row>,
        ]}
      </Rows>
    </Section>
  )
}
