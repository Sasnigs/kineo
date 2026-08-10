# M2 Dependency Review — GRDB

| Field | Decision |
| --- | --- |
| Package | GRDB.swift |
| Version | `7.10.0` |
| Revision | `36e30a6f1ef10e4194f6af0cff90888526f0c115` |
| Pinning | Exact version in `Package.swift`; revision recorded in both lockfiles |
| Purpose | Typed, transactional access to the local SQLite store |
| License | MIT |
| Runtime dependencies | System SQLite only in the selected default package configuration |
| Privacy manifest | Included; declares no tracking, collected data, tracking domains, or accessed API categories |
| Network or entitlements | None introduced by this dependency |

Reviewed from the pinned checkout's `Package.swift`, `LICENSE`, and `GRDB/PrivacyInfo.xcprivacy` on August 9, 2026. Upstream: <https://github.com/groue/GRDB.swift>.

**Decision:** approved for M2. Re-review version, lockfile revision, license, manifest, and transitive dependencies before any upgrade.
