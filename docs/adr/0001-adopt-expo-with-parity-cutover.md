---
status: accepted
---

# Adopt Expo through a parity-gated cutover

Kineo moved from SwiftUI to an Expo SDK 57 / React Native implementation in `apps/mobile`. The Expo app has passed automated product, safety, persistence, privacy, accessibility, and offline parity gates. Stable parity fixtures now live with the Expo tests; the Swift reference remains only until the E6 device and archive gates pass.

Brownfield embedding is rejected because it adds two runtimes and Expo currently labels that integration path alpha. Android and web become possible future targets, but this decision does not expand version-one scope beyond iPhone or authorize networking, telemetry, accounts, public distribution, or changes to product behavior.

A narrow Swift Expo module remains for iOS Complete Protection and backup exclusion because Expo's JavaScript APIs do not expose those file attributes. It is infrastructure, not a second product runtime.
