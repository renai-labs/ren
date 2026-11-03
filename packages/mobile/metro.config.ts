import { getDefaultConfig } from "expo/metro-config"
import { withUniwindConfig } from "uniwind/metro"

const config = getDefaultConfig(import.meta.dirname)
const resolveRequest = config.resolver.resolveRequest

export default withUniwindConfig(
  {
    ...config,
    resolver: {
      ...config.resolver,
      resolveRequest: (context, moduleName, platform) => {
        const resolve = resolveRequest ?? context.resolveRequest
        const workspaceScript =
          moduleName.startsWith(".") && moduleName.endsWith(".js") && !context.originModulePath.includes("node_modules")
        return resolve(context, workspaceScript ? moduleName.slice(0, -".js".length) : moduleName, platform)
      },
    },
  },
  { cssEntryFile: "./src/global.css", dtsFile: "./src/uniwind-types.d.ts" },
)
