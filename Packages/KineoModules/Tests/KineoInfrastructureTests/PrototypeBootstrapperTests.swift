import KineoCore
@testable import KineoInfrastructure
import Foundation
import XCTest

final class PrototypeBootstrapperTests: XCTestCase {
    func testBootstrapperOpensRealStore() async throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "KineoBootstrapperTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: root) }
        let subject: any AppBootstrapping = PrototypeBootstrapper(
            location: KineoStoreLocation(applicationSupportURL: root),
            storageProtector: NoOpKineoStorageProtector()
        )

        let state = await subject.initialState()
        XCTAssertEqual(state, .foundationReady)
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: root.appending(path: "KineoPrivate/kineo.sqlite").path
            )
        )
    }

    func testBootstrapperReportsProtectedDataUnavailable() async {
        let subject: any AppBootstrapping = PrototypeBootstrapper(
            protectedData: UnavailableProtectedData()
        )

        let state = await subject.initialState()
        XCTAssertEqual(state, .protectedDataUnavailable)
    }

    func testBootstrapperRetriesAfterProtectedDataReturns() async throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "KineoBootstrapRetryTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: root) }
        let availability = MutableProtectedDataAvailability(isAvailable: false)
        let subject: any AppBootstrapping = PrototypeBootstrapper(
            location: KineoStoreLocation(applicationSupportURL: root),
            protectedData: availability,
            storageProtector: NoOpKineoStorageProtector()
        )

        let unavailableState = await subject.initialState()
        XCTAssertEqual(unavailableState, .protectedDataUnavailable)
        await availability.setAvailable(true)
        let readyState = await subject.initialState()
        XCTAssertEqual(readyState, .foundationReady)
    }

    func testBootstrapperFinishesPendingDeletionThenCreatesFreshStore() async throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "KineoBootstrapDeletionTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: root) }
        let location = KineoStoreLocation(applicationSupportURL: root)
        let interrupted = try await KineoGRDBStore.open(
            location: location,
            storageProtector: NoOpKineoStorageProtector(),
            failure: KineoStoreFailureInjection(points: [.deletionAfterMarker])
        )
        do {
            try await interrupted.performVerifiedDeletion()
            XCTFail("Expected injected deletion failure.")
        } catch {}

        let subject: any AppBootstrapping = PrototypeBootstrapper(
            location: location,
            storageProtector: NoOpKineoStorageProtector()
        )
        let state = await subject.initialState()
        XCTAssertEqual(state, .foundationReady)
        XCTAssertFalse(FileManager.default.fileExists(atPath: location.deletionMarkerURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: location.databaseURL.path))
    }

    func testBootstrapperValidatesDomainSnapshotBeforeReady() async throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "KineoBootstrapCorruptionTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: root) }
        let location = KineoStoreLocation(applicationSupportURL: root)
        let store = try await KineoGRDBStore.open(
            location: location,
            storageProtector: NoOpKineoStorageProtector()
        )
        _ = try await store.transaction(name: "insert-domain-invalid-check-in") { db in
            try db.execute(
                sql: """
                INSERT INTO check_ins(
                    id, status, purpose, primary_area, started_at_ms, completed_at_ms,
                    local_day, time_zone_id, calendar_id
                ) VALUES (?, 'completed', 'normal', 'neck', 1, 2, '2026-08-09',
                          'America/Chicago', 'gregorian')
                """,
                arguments: ["00000000-0000-0000-0000-000000000301"]
            )
            return true
        }
        try await store.closeForDeletion()
        let subject: any AppBootstrapping = PrototypeBootstrapper(
            location: location,
            storageProtector: NoOpKineoStorageProtector()
        )

        let state = await subject.initialState()

        XCTAssertEqual(state, .foundationUnavailable)
    }

    func testBootstrapperReportsLockRaceDuringSnapshotValidation() async throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "KineoBootstrapLockRaceTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: root) }
        let subject: any AppBootstrapping = PrototypeBootstrapper(
            location: KineoStoreLocation(applicationSupportURL: root),
            protectedData: SequencedProtectedDataAvailability(results: [true, false]),
            storageProtector: NoOpKineoStorageProtector()
        )

        let state = await subject.initialState()

        XCTAssertEqual(state, .protectedDataUnavailable)
    }
}

private actor MutableProtectedDataAvailability: KineoProtectedDataAvailability {
    private var isAvailable: Bool

    init(isAvailable: Bool) {
        self.isAvailable = isAvailable
    }

    func setAvailable(_ value: Bool) {
        isAvailable = value
    }

    func isProtectedDataAvailable() -> Bool {
        isAvailable
    }
}

private actor SequencedProtectedDataAvailability: KineoProtectedDataAvailability {
    private var results: [Bool]

    init(results: [Bool]) {
        self.results = results
    }

    func isProtectedDataAvailable() -> Bool {
        guard !results.isEmpty else { return false }
        return results.removeFirst()
    }
}
