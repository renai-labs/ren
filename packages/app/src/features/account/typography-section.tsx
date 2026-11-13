import { IconCode } from "@tabler/icons-react"
import { Rows, Section } from "../../components/page.js"
import { ChoiceRow } from "../../components/preference-rows.js"
import {
  IconLetter,
  IconLetterLarge,
  IconLetterLarger,
  IconLetterMedium,
  IconLetterSmall,
} from "../../icons/preferences.js"
import { AppearancePreferences } from "../../lib/appearance-preferences.js"

const sizeIcons = [IconLetterSmall, IconLetterMedium, IconLetterLarge, IconLetterLarger]

const uiFonts = AppearancePreferences.uiFonts.map((font) => ({ ...font, icon: IconLetter }))

const codeFonts = AppearancePreferences.codeFonts.map((font) => ({ ...font, icon: IconCode }))

const uiSizes = AppearancePreferences.uiSizes.map((size, index) => ({ ...size, icon: sizeIcons[index] }))

const codeSizes = AppearancePreferences.codeSizes.map((size, index) => ({ ...size, icon: sizeIcons[index] }))

export function TypographySection() {
  return (
    <Section title="Typography">
      <Rows>
        {[
          <ChoiceRow
            key="ui-font"
            title="Interface font"
            preference={AppearancePreferences.uiFont}
            options={uiFonts}
          />,
          <ChoiceRow
            key="ui-size"
            title="Interface size"
            preference={AppearancePreferences.uiSize}
            options={uiSizes}
          />,
          <ChoiceRow
            key="code-font"
            title="Code font"
            preference={AppearancePreferences.codeFont}
            options={codeFonts}
          />,
          <ChoiceRow
            key="code-size"
            title="Code size"
            preference={AppearancePreferences.codeSize}
            options={codeSizes}
          />,
        ]}
      </Rows>
    </Section>
  )
}
