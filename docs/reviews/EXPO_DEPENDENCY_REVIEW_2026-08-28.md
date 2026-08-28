# Expo capability dependency review — August 28, 2026

| Package | Version | License | Approved purpose | Boundary and fallback |
| --- | --- | --- | --- | --- |
| `expo-crypto` | 57.0.2 | MIT | SHA-256 file verification | No user data or networking; fallback is the existing narrow native digest seam |
| `expo-video` | 57.0.3 | MIT | Play bundled prototype media | Kineo passes bundled assets only; remote URLs, caching, DRM, and now-playing artwork are prohibited; fallback is reviewed text/static media |
| `expo-notifications` | 57.0.15 | MIT | One generic local reminder | No push token, server, sensitive copy, or remote notification entitlement; fallback is no reminder |

All three packages come from the maintained Expo monorepo and are pinned to Expo SDK 57-compatible versions in the lockfile. `expo-notifications` declares no collection or tracking and declares UserDefaults access reason `CA92.1`; the generated native build remains subject to archive privacy-manifest review.

The repository boundary check allowlists direct runtime dependencies and rejects production Expo network clients, endpoints, HealthKit, added Apple capabilities, tracked generated projects, secret patterns, and unreviewed privacy manifests. `expo-video` contains optional remote-media code internally, so runtime network inspection remains an E6 gate even though Kineo supplies only a bundled numeric asset reference.

Decision: approved for the internal prototype. Re-review versions, licenses, manifests, entitlements, and runtime traffic before any upgrade or public distribution.
