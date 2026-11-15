import { Schema } from "effect"
import type { ExpoConfig } from "expo/config"

const variant = process.env.APP_VARIANT ?? "production"

if (!Schema.is(Schema.Literals(["development", "preview", "production"]))(variant))
  throw new Error(`APP_VARIANT must be development, preview or production, not "${variant}"`)

const identity = {
  development: { name: "Ren (Dev)", id: "ai.ren.app.dev", scheme: "ren-dev" },
  preview: { name: "Ren (Preview)", id: "ai.ren.app.preview", scheme: "ren-preview" },
  production: { name: "Ren", id: "ai.ren.app", scheme: "ren" },
}[variant]

const projectId = "aa48fd7d-fca0-463d-94b9-0ed19d91d3d6"

export default {
  name: identity.name,
  slug: "ren",
  scheme: identity.scheme,
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/android-icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#f9f9f9",
  platforms: ["ios", "android"],
  ios: {
    bundleIdentifier: identity.id,
    supportsTablet: false,
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    package: identity.id,
    icon: "./assets/android-icon.png",
    adaptiveIcon: {
      foregroundImage: "./assets/android-foreground.png",
      backgroundColor: "#f9f9f9",
    },
  },
  plugins: [
    "expo-router",
    ["expo-dev-client", { addGeneratedScheme: variant === "development" }],
    [
      "expo-image-picker",
      {
        photosPermission: "Allow $(PRODUCT_NAME) to pick photos and videos to upload to your drive.",
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#f9f9f9",
        image: "./assets/android-foreground.png",
        imageWidth: 200,
      },
    ],
    [
      "expo-font",
      {
        android: {
          fonts: [
            {
              fontFamily: "Inter",
              fontDefinitions: [
                {
                  path: "./node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
                  weight: 400,
                },
                {
                  path: "./node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf",
                  weight: 500,
                },
                {
                  path: "./node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf",
                  weight: 600,
                },
                {
                  path: "./node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf",
                  weight: 700,
                },
              ],
            },
            {
              fontFamily: "IBM Plex Mono",
              fontDefinitions: [
                {
                  path: "./node_modules/@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf",
                  weight: 400,
                },
                {
                  path: "./node_modules/@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf",
                  weight: 500,
                },
              ],
            },
          ],
        },
        ios: {
          fonts: [
            "./node_modules/@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf",
            "./node_modules/@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf",
          ],
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  runtimeVersion: { policy: "fingerprint" },
  updates: {
    url: `https://u.expo.dev/${projectId}`,
  },
  extra: {
    eas: { projectId },
  },
  owner: "renagent",
} satisfies ExpoConfig
