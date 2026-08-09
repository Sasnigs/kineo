# Kineo

Kineo is a native iPhone wellness app for adults with recurring back or neck discomfort. It uses a short daily check-in, explicit safety boundaries, and a deterministic content catalog to present a bounded movement routine. It does not diagnose or treat a medical condition.

## Project status

- M1 complete: project and module foundation
- M2 not started: domain and local persistence
- Minimum deployment target: iOS 17
- Required development toolchain: Xcode 16.3+ with Swift 6.1+

## Start here

1. Read the [product design](docs/KINEO_PRODUCT_DESIGN.md).
2. Review the [milestone plan](docs/KINEO_IMPLEMENTATION_MILESTONES.md).
3. Use the [technical design index](docs/technical/00_TECHNICAL_DESIGN_INDEX.md) to find the contract for your change.
4. Follow [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

Open `Kineo.xcodeproj`, select the shared `Kineo` scheme and an iPhone simulator, then run the app with `⌘R` or tests with `⌘U`.

```sh
swift test --package-path Packages/KineoModules
xcodebuild -project Kineo.xcodeproj \
  -scheme Kineo \
  -configuration DebugPrototype \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

The project is local-first. Do not add networking, analytics, HealthKit, cloud storage, background modes, or new entitlements without an approved design change.
