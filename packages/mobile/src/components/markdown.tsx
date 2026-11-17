import { ChatLink } from "@ren/chat"
import { Fences } from "@ren/chat/fences"
import { TexMath } from "@ren/chat/tex-math"
import { setStringAsync } from "expo-clipboard"
import { useRouter } from "expo-router"
import { openBrowserAsync } from "expo-web-browser"
import { Linking } from "react-native"
import { EnrichedMarkdownText } from "react-native-enriched-markdown"
import { useCSSVariable, useUniwind } from "uniwind"
import { Auth } from "#lib/auth"

const libraryDefault = ""

const string = (value: string | number | undefined) => (typeof value === "string" ? value : libraryDefault)

const web = /^https?:/iu
const handoff = /^(?:mailto|tel):/iu
const relative = "^(?![A-Za-z][A-Za-z0-9+.-]*:)"

const loneDollar = /(`+)[\s\S]*?\1|\\[\s\S]|\$\$|\$/gu

function Markdown(props: { readonly text: string; readonly streaming?: boolean; readonly size?: "sm" }) {
  const router = useRouter()
  const dark = useUniwind().theme === "dark"
  const foreground = string(useCSSVariable("--color-foreground"))
  const mutedForeground = string(useCSSVariable("--color-muted-foreground"))
  const muted = string(useCSSVariable("--color-muted"))
  const secondary = string(useCSSVariable("--color-secondary"))
  const border = string(useCSSVariable("--color-border"))
  const input = string(useCSSVariable("--color-input"))
  const primary = string(useCSSVariable("--color-primary"))
  const primaryForeground = string(useCSSVariable("--color-primary-foreground"))
  const destructive = string(useCSSVariable("--color-destructive"))
  const link = string(useCSSVariable("--color-link"))
  const chart1 = string(useCSSVariable("--color-chart-1"))
  const chart2 = string(useCSSVariable("--color-chart-2"))
  const chart3 = string(useCSSVariable("--color-chart-3"))
  const chart6 = string(useCSSVariable("--color-chart-6"))
  const sans = string(useCSSVariable("--font-sans"))
  const mono = string(useCSSVariable("--font-mono"))
  const size = props.size === "sm" ? 13 : 15
  const gap = Math.round(size * 0.75)
  const body = { fontSize: size, lineHeight: Math.round(size * 1.6), color: foreground, fontFamily: sans }
  const heading = (fontSize: number, emphasis: "high" | "low") => ({
    fontSize,
    lineHeight: Math.round(fontSize * 1.3),
    fontFamily: sans,
    fontWeight: emphasis === "high" ? "600" : "500",
    color: emphasis === "high" ? foreground : mutedForeground,
    marginTop: Math.max(0, Math.round(fontSize * 1.5) - gap),
    marginBottom: Math.round(fontSize * 0.5),
  })
  const scale = size / 16
  return (
    <EnrichedMarkdownText
      markdown={Fences.mapProse(TexMath.rewrite(props.text), (prose) =>
        prose.replace(loneDollar, (match) => (match === "$" ? "\\$" : match)),
      )}
      flavor="github"
      streamingAnimation={props.streaming === true}
      selectable
      enableTaskListItemToggle={false}
      onLinkPress={(event) => {
        const chat = ChatLink.parse(event.url, Auth.webUrl)
        if (chat) router.navigate({ pathname: "/chat/[id]", params: { id: chat.id } })
        else if (web.test(event.url)) void openBrowserAsync(event.url)
        else if (handoff.test(event.url)) void Linking.openURL(event.url)
      }}
      onLinkLongPress={(event) => void setStringAsync(event.url)}
      onImagePress={(event) => {
        if (web.test(event.url)) void openBrowserAsync(event.url)
      }}
      markdownStyle={{
        paragraph: { ...body, marginBottom: gap },
        h1: heading(20 * scale, "high"),
        h2: heading(18 * scale, "high"),
        h3: heading(size, "high"),
        h4: heading(size, "low"),
        h5: heading(size, "low"),
        h6: heading(size, "low"),
        list: {
          ...body,
          marginBottom: gap,
          itemSpacing: Math.round(size * 0.25),
          bulletColor: mutedForeground,
          markerColor: mutedForeground,
          markerFontWeight: "400",
        },
        taskList: {
          checkedColor: primary,
          borderColor: mutedForeground,
          checkmarkColor: primaryForeground,
          checkedTextColor: mutedForeground,
          checkboxSize: Math.round(size * 0.875),
          checkboxBorderRadius: 4,
        },
        blockquote: {
          ...body,
          color: mutedForeground,
          marginBottom: gap,
          borderColor: border,
          borderWidth: 2,
          gapWidth: gap,
          backgroundColor: "transparent",
          admonitions: {
            note: { color: chart1 },
            tip: { color: chart2 },
            important: { color: chart6 },
            warning: { color: chart3 },
            caution: { color: destructive },
          },
        },
        strong: { color: foreground },
        em: { color: foreground },
        strikethrough: { color: mutedForeground },
        underline: { color: foreground },
        link: { color: link, underline: false },
        linkVariants: { [relative]: { color: foreground } },
        code: {
          fontFamily: mono,
          fontSize: Math.round(size * 0.9),
          color: foreground,
          backgroundColor: dark ? secondary : muted,
          borderColor: "transparent",
        },
        codeBlock: {
          fontFamily: mono,
          fontSize: size - 2,
          lineHeight: Math.round((size - 2) * 1.625),
          color: foreground,
          marginBottom: gap,
          backgroundColor: "transparent",
          borderColor: input,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          syntaxColors: {
            keyword: chart6,
            string: chart2,
            number: chart1,
            constant: chart1,
            comment: mutedForeground,
            function: chart6,
            type: chart3,
            property: chart1,
            tag: chart2,
            attribute: chart1,
          },
        },
        math: { fontSize: size + 2, color: foreground, backgroundColor: "transparent", padding: 0, marginBottom: gap },
        inlineMath: { color: foreground },
        image: { maxHeight: 384, resizeMode: "contain", borderRadius: 6, marginBottom: gap },
        table: {
          ...body,
          fontSize: size - 2,
          lineHeight: Math.round((size - 2) * 1.5),
          marginBottom: gap,
          headerFontFamily: sans,
          headerBackgroundColor: "transparent",
          headerTextColor: mutedForeground,
          rowEvenBackgroundColor: "transparent",
          rowOddBackgroundColor: "transparent",
          borderColor: border,
          borderWidth: 1,
          borderRadius: 0,
          cellPaddingHorizontal: 12,
          cellPaddingVertical: 8,
        },
        spoiler: { color: mutedForeground },
        thematicBreak: { color: border, marginTop: size * 1.5, marginBottom: size * 1.5 },
      }}
    />
  )
}

export { Markdown }
