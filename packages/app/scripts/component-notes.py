"""Create src/components/ui/<name>.md for every shadcn component that has no note yet.

Never overwrites an existing note: once a component is changed, its note is edited by hand.
Run: python3 scripts/component-notes.py
"""
import glob
import os
import re

ROLE = {
    "background": ("#151515", "Ren bg-primary — the main page surface"),
    "foreground": ("#f1f1f1", "Ren text-primary"),
    "card": ("#1f1f1f", "Ren bg-secondary — raised surfaces"),
    "card-foreground": ("#f1f1f1", "Ren text-primary"),
    "popover": ("#1f1f1f", "Ren bg-secondary — menus and popups"),
    "popover-foreground": ("#f1f1f1", "Ren text-primary"),
    "primary": ("#f1f1f1", "Ren text-primary used as a fill — the strongest action"),
    "primary-foreground": ("#101010", "Ren text-inverse"),
    "secondary": ("white at 8%", "Ren fill-secondary"),
    "secondary-foreground": ("#f1f1f1", "Ren text-primary"),
    "muted": ("white at 4%", "Ren fill-primary"),
    "muted-foreground": ("#a3a3a3", "Ren text-secondary"),
    "accent": ("white at 8%", "Ren fill-secondary — hover and highlighted rows"),
    "accent-foreground": ("#f1f1f1", "Ren text-primary"),
    "destructive": ("#f47780", "Ren status-danger"),
    "border": ("white at 8%", "Ren border-primary"),
    "input": ("white at 8%", "Ren border-primary"),
    "ring": ("#268bff", "Ren accent-primary — focus rings"),
    "sidebar": ("#101010", "Ren bg-tertiary"),
    "sidebar-foreground": ("#a3a3a3", "Ren text-secondary"),
    "sidebar-primary": ("#f1f1f1", "Ren text-primary"),
    "sidebar-primary-foreground": ("#101010", "Ren text-inverse"),
    "sidebar-accent": ("white at 8%", "Ren fill-secondary — hover and the current page"),
    "sidebar-accent-foreground": ("#f1f1f1", "Ren text-primary"),
    "sidebar-border": ("white at 8%", "Ren border-primary"),
    "sidebar-ring": ("#268bff", "Ren accent-primary"),
}
SIZES = {"sm": "4.8px", "md": "6.4px", "lg": "8px", "xl": "11.2px", "2xl": "14.4px", "3xl": "17.6px", "4xl": "20.8px"}
NAMES = sorted(ROLE, key=len, reverse=True)
TOKEN = re.compile(
    r"(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|placeholder|caret|decoration|shadow)-("
    + "|".join(map(re.escape, NAMES))
    + r")(?![\w-])"
)

for path in sorted(glob.glob("src/components/ui/*.tsx")):
    name = os.path.basename(path)[:-4]
    note = f"src/components/ui/{name}.md"
    if os.path.exists(note):
        continue
    src = open(path).read()
    used = sorted(set(TOKEN.findall(src)), key=list(ROLE).index)
    radius = sorted(set(re.findall(r"rounded-(sm|md|lg|xl|2xl|3xl|4xl)\b", src)))
    icons = sorted(set(re.findall(r"\b(Icon[A-Z]\w+)\b", src)))
    title = " ".join(word.capitalize() for word in name.split("-"))
    lines = [
        f"# {title}",
        "",
        f"Generated with `shadcn add {name}` (style `base-nova`, Base UI).",
        "",
        "## Changes to the component",
        "",
        f"None. The code in `{name}.tsx` is exactly what the shadcn CLI generated. Its props, parts and names are shadcn's.",
        "",
        "## What looks different, and why",
        "",
        "Only the theme changed (see `src/index.css`). This component reads these theme values:",
        "",
    ]
    if used:
        lines += ["| shadcn variable | Ren value | Ren role |", "| --- | --- | --- |"]
        lines += [f"| `{u}` | {ROLE[u][0]} | {ROLE[u][1]} |" for u in used]
    else:
        lines += ["No color variables."]
    lines += [""]
    if radius:
        sizes = ", ".join(f"`rounded-{r}` is {SIZES[r]}" for r in radius)
        lines += [f"Corners: `--radius` is 8px (Ren's control radius) instead of shadcn's 10px, so {sizes}.", ""]
    if icons:
        names = ", ".join(f"`{i}`" for i in icons)
        lines += [f"Icons: Tabler instead of Lucide, because `components.json` sets `iconLibrary` to `tabler` ({names}).", ""]
    lines += ["Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.", ""]
    open(note, "w").write("\n".join(lines))
    print("created", note)
