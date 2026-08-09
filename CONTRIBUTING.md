# Contributing to Kineo

## Before changing code

1. Read the current milestone in `docs/KINEO_IMPLEMENTATION_MILESTONES.md`.
2. Find the owning contract in `docs/technical/00_TECHNICAL_DESIGN_INDEX.md`.
3. Keep the change inside that milestone and contract. Record an intentional design change before implementing behavior that conflicts with them.

## Branches and commits

- Create a short-lived branch from an up-to-date `main`, such as `feat/m2-persistence`, `fix/check-in-recovery`, or `docs/testing-contract`.
- Keep each pull request focused on one outcome.
- Use short imperative commit messages, such as `Add profile repository contract`.
- Never commit secrets, credentials, user data, build output, or Xcode user state.

## Required verification

Run the relevant tests before requesting review:

```sh
swift test --package-path Packages/KineoModules
xcodebuild -project Kineo.xcodeproj \
  -scheme Kineo \
  -configuration DebugPrototype \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

- Add unit tests for new behavior.
- Add a regression test for every bug fix when practical.
- Run the app or relevant flow in an iPhone simulator for UI changes.
- Update documentation only when the product or technical contract changes.

## Pull requests

- Open a draft pull request early when the change benefits from discussion.
- Complete the pull request template and name the milestone and acceptance scenarios affected.
- Include screenshots or a short recording for visible UI changes.
- Call out safety, privacy, persistence, dependency, capability, and entitlement changes explicitly.
- Resolve review comments and pass CI before merge.
- Prefer squash merge and delete the branch afterward.

Until another maintainer is assigned, the product owner performs the final scope and contract review. Safety-boundary or production-content changes require the review evidence specified by the technical designs; ordinary code review does not replace it.
