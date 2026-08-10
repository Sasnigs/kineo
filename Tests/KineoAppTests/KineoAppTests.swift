@testable import KineoApp
import KineoInfrastructure
import Foundation
import XCTest

final class KineoAppTests: XCTestCase {
    @MainActor
    func testCompositionRootCanBeCreated() {
        _ = KineoApp()
    }

    func testStoreFilesAreExcludedFromBackup() async throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "KineoAppStorageTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: root) }

        let store = try await KineoGRDBStore.open(
            location: KineoStoreLocation(applicationSupportURL: root),
            protectedData: AlwaysAvailableProtectedData(),
            storageProtector: FoundationKineoStorageProtector()
        )
        let audit = try await store.storageAudit()

        XCTAssertGreaterThanOrEqual(audit.count, 2)
        XCTAssertTrue(audit.allSatisfy(\.isExcludedFromBackup))
        try await store.deleteAllData()
    }

    func testStoreFilesUseCompleteProtectionOnPhysicalDevice() async throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("The simulator does not report NSFileProtectionKey; physical-device evidence is a later release gate.")
        #else
        let root = FileManager.default.temporaryDirectory
            .appending(path: "KineoAppProtectionTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try await KineoGRDBStore.open(
            location: KineoStoreLocation(applicationSupportURL: root),
            protectedData: AlwaysAvailableProtectedData(),
            storageProtector: FoundationKineoStorageProtector()
        )

        let audit = try await store.storageAudit()
        XCTAssertTrue(audit.allSatisfy(\.hasCompleteProtection))
        try await store.deleteAllData()
        #endif
    }
}
