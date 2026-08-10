# Kineo Engineering Rules

These rules apply to the entire repository.

- Do not use magic numbers. Give domain limits, durations, versions, sizes, and other meaningful numeric values descriptive constants. Self-evident values used by an algorithm, such as an empty count or first index, are not magic numbers.
- Model expected failures with typed errors at module boundaries. Do not use force-try, force-unwrap recoverable values, empty `catch` blocks, or silent `try?` calls. A best-effort cleanup may preserve the primary error only when the code explains why and tests the resulting safe state.
- Map infrastructure failures to domain errors once, show users safe recovery states, and never replace a failed persistent store with an empty one.
- Test failure, rollback, retry, corruption, and protected-data paths when changing persistence or lifecycle code.
- After Swift coding, review the change with the installed `swift-language`, `swift-api-design-guidelines`, `swift-concurrency`, and `swift-testing` skills as applicable, then run focused tests and the full relevant suite before declaring completion.
