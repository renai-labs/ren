import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
