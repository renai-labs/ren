import { useEffect, useState } from "react"
import { AppearancePreferences } from "./appearance-preferences.js"
import { RouterContext } from "./router-context.js"

export function useAppearance() {
  const { platform } = RouterContext.useRouterContext()
  const [values, setValues] = useState(() => AppearancePreferences.read(platform.storage))
  const [uiFont, setUiFont] = useState(values.uiFont)
  const [codeFont, setCodeFont] = useState(values.codeFont)
  const refresh = () =>
    AppearancePreferences.apply(document.documentElement, AppearancePreferences.read(platform.storage))
  useEffect(() => {
    const timer = setTimeout(() => {
      AppearancePreferences.uiFont.write(platform.storage, uiFont)
      AppearancePreferences.codeFont.write(platform.storage, codeFont)
      AppearancePreferences.apply(document.documentElement, AppearancePreferences.read(platform.storage))
    }, 300)
    return () => clearTimeout(timer)
  }, [platform, uiFont, codeFont])
  return {
    uiFont,
    codeFont,
    uiSize: values.uiSize,
    codeSize: values.codeSize,
    setUiFont,
    setCodeFont,
    setUiSize: (size: typeof values.uiSize) => {
      AppearancePreferences.uiSize.write(platform.storage, size)
      setValues({ ...values, uiSize: size })
      refresh()
    },
    setCodeSize: (size: typeof values.codeSize) => {
      AppearancePreferences.codeSize.write(platform.storage, size)
      setValues({ ...values, codeSize: size })
      refresh()
    },
    reset: () => {
      AppearancePreferences.uiFont.write(platform.storage, "")
      AppearancePreferences.uiSize.write(platform.storage, 16)
      AppearancePreferences.codeFont.write(platform.storage, "")
      AppearancePreferences.codeSize.write(platform.storage, 1)
      setUiFont("")
      setCodeFont("")
      setValues({ uiFont: "", uiSize: 16, codeFont: "", codeSize: 1 })
      refresh()
    },
  }
}
