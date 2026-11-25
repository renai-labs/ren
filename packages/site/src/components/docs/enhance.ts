const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
const SIDEBAR_VIEWPORT = "#nd-sidebar .overscroll-contain"

async function copyCode(button: HTMLButtonElement) {
  const clone = button.closest("figure")?.querySelector("pre")?.cloneNode(true)
  if (!(clone instanceof HTMLElement)) return
  for (const node of clone.querySelectorAll(".nd-copy-ignore")) node.replaceWith("\n")
  await navigator.clipboard.writeText(clone.textContent)
  const icon = button.querySelector("svg")
  const original = icon?.outerHTML
  button.dataset.checked = ""
  if (icon) icon.outerHTML = CHECK_ICON
  window.setTimeout(() => {
    delete button.dataset.checked
    const current = button.querySelector("svg")
    if (current && original) current.outerHTML = original
  }, 1500)
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return
  const button = event.target.closest<HTMLButtonElement>("#nd-page figure.shiki button[aria-live]")
  if (button) void copyCode(button).catch(() => undefined)
})

let sidebarScroll = 0

document.addEventListener("astro:before-swap", () => {
  sidebarScroll = document.querySelector<HTMLElement>(SIDEBAR_VIEWPORT)?.scrollTop ?? 0
})

document.addEventListener("astro:after-swap", () => {
  const viewport = document.querySelector<HTMLElement>(SIDEBAR_VIEWPORT)
  if (viewport) viewport.scrollTop = sidebarScroll
})

const HARNESS_KEY = "ren-docs-harness"

function showHarness(id: string) {
  if (!document.querySelector(`[data-harness-pick="${id}"]`)) return
  for (const button of document.querySelectorAll<HTMLElement>("[data-harness-pick]"))
    button.setAttribute("aria-selected", String(button.dataset.harnessPick === id))
  for (const panel of document.querySelectorAll<HTMLElement>("[data-harness]"))
    panel.hidden = panel.dataset.harness !== id
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return
  const id = event.target.closest<HTMLElement>("[data-harness-pick]")?.dataset.harnessPick
  if (!id) return
  localStorage.setItem(HARNESS_KEY, id)
  showHarness(id)
})

const restoreHarness = () => showHarness(localStorage.getItem(HARNESS_KEY) ?? "")

restoreHarness()
document.addEventListener("astro:after-swap", restoreHarness)
