@testable import KineoInfrastructure
import GRDB
import XCTest

final class KineoGRDBStoreSchemaTests: XCTestCase {
    func testInitialMigrationCreatesCompleteSchemaAndReopensIdempotently() async throws {
        let fixture = try TemporaryStoreFixture()
        let store = try await fixture.open()

        let first = try await store.read { db -> SchemaEvidence in
            let version = try Int.fetchOne(db, sql: "PRAGMA user_version") ?? -1
            let tables = Set(try String.fetchAll(
                db,
                sql: "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'grdb_migrations'"
            ))
            let indexes = Set(try String.fetchAll(
                db,
                sql: "SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%'"
            ))
            let migration = try Row.fetchOne(
                db,
                sql: "SELECT version, name, checksum FROM schema_migrations"
            )
            return SchemaEvidence(
                version: version,
                tables: tables,
                indexes: indexes,
                migrationVersion: migration?["version"] ?? -1,
                migrationName: migration?["name"] ?? "",
                migrationChecksum: migration?["checksum"] ?? ""
            )
        }

        XCTAssertEqual(first.version, 1)
        XCTAssertEqual(first.migrationVersion, 1)
        XCTAssertEqual(first.migrationName, "v1_initial")
        XCTAssertEqual(first.migrationChecksum, KineoDatabaseSchema.migrationChecksum)
        XCTAssertEqual(first.tables, expectedTables)
        XCTAssertTrue(expectedIndexes.isSubset(of: first.indexes))

        try await store.closeForDeletion()
        let reopened = try await fixture.open()
        let second = try await reopened.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM schema_migrations") ?? -1
        }
        XCTAssertEqual(second, 1)
    }

    func testMigrationFailureRollsBackSchemaAndUserVersion() async throws {
        let fixture = try TemporaryStoreFixture()
        let protector = RecordingStorageProtector()

        await XCTAssertThrowsErrorAsync {
            _ = try await KineoGRDBStore.open(
                location: fixture.location,
                storageProtector: protector,
                failure: KineoStoreFailureInjection(points: [.migrationStatement(2)])
            )
        } verify: { error in
            XCTAssertEqual(error as? KineoPersistenceFailure, .injectedFailure)
        }

        let queue = try DatabaseQueue(path: fixture.location.databaseURL.path)
        let evidence = try await queue.read { db -> (Int, Bool) in
            (
                try Int.fetchOne(db, sql: "PRAGMA user_version") ?? -1,
                try db.tableExists("user_profile")
            )
        }
        XCTAssertEqual(evidence.0, 0)
        XCTAssertFalse(evidence.1)
        XCTAssertTrue(protector.protectedPaths.contains(fixture.location.databaseURL.path))
    }

    func testFutureSchemaIsPreservedAndRejected() async throws {
        let fixture = try TemporaryStoreFixture()
        let store = try await fixture.open()
        _ = try await store.transaction(name: "future-fixture") { db in
            try db.execute(sql: "PRAGMA user_version = 2")
            return true
        }
        try await store.closeForDeletion()
        let protector = RecordingStorageProtector()

        await XCTAssertThrowsErrorAsync {
            _ = try await KineoGRDBStore.open(
                location: fixture.location,
                storageProtector: protector
            )
        } verify: { error in
            XCTAssertEqual(error as? KineoPersistenceFailure, .futureSchema(2))
        }

        let queue = try DatabaseQueue(path: fixture.location.databaseURL.path)
        let version = try await queue.read { db in
            try Int.fetchOne(db, sql: "PRAGMA user_version") ?? -1
        }
        XCTAssertEqual(version, 2)
        XCTAssertTrue(protector.protectedPaths.contains(fixture.location.databaseURL.path))
    }

    func testEditedMigrationChecksumIsRejectedWithoutRecreation() async throws {
        let fixture = try TemporaryStoreFixture()
        let store = try await fixture.open()
        _ = try await store.transaction(name: "checksum-fixture") { db in
            try db.execute(
                sql: "UPDATE schema_migrations SET checksum = ? WHERE version = 1",
                arguments: [String(repeating: "0", count: 64)]
            )
            return true
        }
        try await store.closeForDeletion()

        await XCTAssertThrowsErrorAsync {
            _ = try await fixture.open()
        } verify: { error in
            XCTAssertEqual(error as? KineoPersistenceFailure, .migrationIntegrity)
        }

        let queue = try DatabaseQueue(path: fixture.location.databaseURL.path)
        let checksum = try await queue.read { db in
            try String.fetchOne(db, sql: "SELECT checksum FROM schema_migrations")
        }
        XCTAssertEqual(checksum, String(repeating: "0", count: 64))
    }

    func testDatabaseConstraintsRejectInvalidAreaPair() async throws {
        let fixture = try TemporaryStoreFixture()
        let store = try await fixture.open()

        await XCTAssertThrowsErrorAsync {
            _ = try await store.transaction(name: "invalid-profile") { db in
                try db.execute(
                    sql: """
                    INSERT INTO user_profile(
                        singleton_id, adult_acknowledged, primary_area, secondary_area,
                        weekly_goal_days, telemetry_choice, created_at_ms, updated_at_ms
                    ) VALUES (1, 0, 'neck', 'neck', 3, 'notOffered', 1, 1)
                    """
                )
                return true
            }
        } verify: { error in
            XCTAssertEqual(error as? KineoPersistenceFailure, .constraint)
        }

        let count = try await store.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM user_profile") ?? -1
        }
        XCTAssertEqual(count, 0)
    }

    func testProtectedDataUnavailableCreatesNoStore() async throws {
        let fixture = try TemporaryStoreFixture()

        await XCTAssertThrowsErrorAsync {
            _ = try await fixture.open(protectedData: UnavailableProtectedData())
        } verify: { error in
            XCTAssertEqual(error as? KineoPersistenceFailure, .protectedDataUnavailable)
        }

        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.location.privateDirectoryURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.location.databaseURL.path))
    }

    func testInterruptedDeletionIsResumedAndNeverSilentlyRecreates() async throws {
        let fixture = try TemporaryStoreFixture()
        let failure = KineoStoreFailureInjection(points: [.deletionAfterPrivateDirectory])
        let store = try await fixture.open(failure: failure)

        await XCTAssertThrowsErrorAsync {
            try await store.performVerifiedDeletion()
        } verify: { error in
            XCTAssertEqual(error as? KineoPersistenceFailure, .injectedFailure)
        }

        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.location.deletionMarkerURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.location.privateDirectoryURL.path))

        await XCTAssertThrowsErrorAsync {
            _ = try await fixture.open()
        } verify: { error in
            XCTAssertEqual(error as? KineoPersistenceFailure, .deletedStore)
        }

        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.location.deletionMarkerURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.location.privateDirectoryURL.path))
    }

    func testDeletionRecoveryResumesEveryPreRemovalPhase() async throws {
        for point in [KineoStoreFaultPoint.deletionAfterMarker, .deletionAfterClose] {
            let fixture = try TemporaryStoreFixture()
            let store = try await fixture.open(
                failure: KineoStoreFailureInjection(points: [point])
            )
            await XCTAssertThrowsErrorAsync {
                try await store.performVerifiedDeletion()
            } verify: { _ in }
            XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.location.deletionMarkerURL.path))

            await XCTAssertThrowsErrorAsync {
                _ = try await fixture.open()
            } verify: { error in
                XCTAssertEqual(error as? KineoPersistenceFailure, .deletedStore)
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.location.deletionMarkerURL.path))
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.location.privateDirectoryURL.path))
        }
    }

    private let expectedTables: Set<String> = [
        "schema_migrations", "user_profile", "reminder_settings", "check_ins",
        "check_in_entries", "safety_events", "attention_states", "pause_today_events",
        "selection_decisions", "decision_area_inputs", "decision_reasons", "decision_notices",
        "routine_sessions", "routine_events", "feedback_submissions", "area_feedback"
    ]

    private let expectedIndexes: Set<String> = [
        "check_ins_chronology", "check_in_entries_area", "safety_events_chronology",
        "pause_today_events_chronology", "decision_area_inputs_history",
        "routine_sessions_chronology", "routine_sessions_status", "one_nonterminal_routine",
        "area_feedback_chronology", "feedback_submissions_session", "routine_events_sequence"
    ]
}

private final class RecordingStorageProtector: @unchecked Sendable, KineoStorageProtecting {
    private let lock = NSLock()
    private var paths: Set<String> = []

    var protectedPaths: Set<String> {
        lock.lock()
        defer { lock.unlock() }
        return paths
    }

    func preparePrivateDirectory(at url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    func protectItem(at url: URL) throws {
        lock.lock()
        paths.insert(url.path)
        lock.unlock()
    }

    func auditItem(at url: URL) throws -> KineoStorageAuditEntry {
        KineoStorageAuditEntry(
            url: url,
            hasCompleteProtection: true,
            isExcludedFromBackup: true
        )
    }
}

private struct SchemaEvidence: Sendable {
    let version: Int
    let tables: Set<String>
    let indexes: Set<String>
    let migrationVersion: Int
    let migrationName: String
    let migrationChecksum: String
}

private final class TemporaryStoreFixture: @unchecked Sendable {
    let location: KineoStoreLocation

    init() throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "KineoStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        location = KineoStoreLocation(applicationSupportURL: root)
    }

    deinit {
        try? FileManager.default.removeItem(at: location.applicationSupportURL)
    }

    func open(
        protectedData: any KineoProtectedDataAvailability = AlwaysAvailableProtectedData(),
        failure: KineoStoreFailureInjection = .none
    ) async throws -> KineoGRDBStore {
        try await KineoGRDBStore.open(
            location: location,
            protectedData: protectedData,
            storageProtector: NoOpKineoStorageProtector(),
            failure: failure
        )
    }
}

private func XCTAssertThrowsErrorAsync(
    _ expression: () async throws -> Void,
    verify: (any Error) -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected an error.", file: file, line: line)
    } catch {
        verify(error)
    }
}
