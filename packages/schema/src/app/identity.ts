export * as AppIdentity from "./identity.js"

import { Identifier } from "../identifier.js"
import { Primitive } from "../primitive.js"

export const ID = Identifier.make("app", "App.ID")
export type ID = typeof ID.Type

export const Ref = Primitive.reference("app", ID, "The app’s slug or ID.")

export const ProfileID = Identifier.make("apf", "AppProfile.ID")
export type ProfileID = typeof ProfileID.Type

export const ProfileRef = Primitive.reference(
  "app-profile",
  ProfileID,
  "The profile’s slug, written <app>/<slug> when two apps have a profile with that slug, or its ID.",
)
