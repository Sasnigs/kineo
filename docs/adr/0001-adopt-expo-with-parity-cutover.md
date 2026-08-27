---
status: accepted
---

# Adopt Expo through a parity-gated cutover

Kineo will move from SwiftUI to an Expo SDK 57 / React Native implementation in `apps/mobile`. The verified Swift app remains runnable as the reference implementation until the Expo app passes the same product, safety, persistence, privacy, accessibility, and offline gates; this avoids an untestable big-bang replacement.

Brownfield embedding is rejected because it adds two runtimes and Expo currently labels that integration path alpha. Android and web become possible future targets, but this decision does not expand version-one scope beyond iPhone or authorize networking, telemetry, accounts, public distribution, or changes to product behavior.
