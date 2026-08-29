---
status: accepted
---

# Adopt Expo through a parity-gated cutover

Kineo moved from SwiftUI to an Expo SDK 57 / React Native implementation in `apps/mobile`. Automated product, safety, persistence, privacy, offline, native-path, and first-screen accessibility gates pass. Stable parity fixtures now live with the Expo tests; common-task UI qualification and the E6 device/archive gates remain before the Swift reference is removed.

Brownfield embedding is rejected because it adds two runtimes and Expo currently labels that integration path alpha. Android and web become possible future targets, but this decision does not expand version-one scope beyond iPhone or authorize networking, telemetry, accounts, public distribution, or changes to product behavior.

A narrow Swift Expo module remains for iOS Complete Protection and backup exclusion because Expo's JavaScript APIs do not expose those file attributes. It is infrastructure, not a second product runtime.
