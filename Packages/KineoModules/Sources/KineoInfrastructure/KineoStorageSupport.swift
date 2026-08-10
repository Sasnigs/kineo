import Foundation

enum KineoPersistenceFailure: Error, Equatable {
    case protectedDataUnavailable
    case futureSchema(Int)
    case migrationIntegrity
    case migrationFailed
    case corruptStore
    case constraint
    case notFound
    case conflict
    case invalidTransition
    case readFailed
    case writeFailed
    case protectionFailed
    case deletionFailed
    case deletedStore
    case injectedFailure
}

public enum KineoStoreFaultPoint: Hashable, Sendable {
    case migrationStatement(Int)
    case migrationBeforeCommit
    case transactionBeforeCommit(String)
    case deletionAfterMarker
    case deletionAfterClose
    case deletionAfterPrivateDirectory
}

public struct KineoStoreFailureInjection: Sendable {
    public static let none = KineoStoreFailureInjection()

    private let points: Set<KineoStoreFaultPoint>

    public init(points: Set<KineoStoreFaultPoint> = []) {
        self.points = points
    }

    func check(_ point: KineoStoreFaultPoint) throws {
        if points.contains(point) {
            throw KineoPersistenceFailure.injectedFailure
        }
    }
}

public protocol KineoProtectedDataAvailability: Sendable {
    func isProtectedDataAvailable() async -> Bool
}

public struct AlwaysAvailableProtectedData: KineoProtectedDataAvailability {
    public init() {}

    public func isProtectedDataAvailable() async -> Bool {
        true
    }
}

public struct UnavailableProtectedData: KineoProtectedDataAvailability {
    public init() {}

    public func isProtectedDataAvailable() async -> Bool {
        false
    }
}

#if canImport(UIKit)
import UIKit

public struct SystemProtectedDataAvailability: KineoProtectedDataAvailability {
    public init() {}

    public func isProtectedDataAvailable() async -> Bool {
        await MainActor.run { UIApplication.shared.isProtectedDataAvailable }
    }
}
#endif

public struct KineoStorageAuditEntry: Equatable, Sendable {
    public let url: URL
    public let hasCompleteProtection: Bool
    public let isExcludedFromBackup: Bool

    public init(url: URL, hasCompleteProtection: Bool, isExcludedFromBackup: Bool) {
        self.url = url
        self.hasCompleteProtection = hasCompleteProtection
        self.isExcludedFromBackup = isExcludedFromBackup
    }
}

public protocol KineoStorageProtecting: Sendable {
    func preparePrivateDirectory(at url: URL) throws
    func protectItem(at url: URL) throws
    func auditItem(at url: URL) throws -> KineoStorageAuditEntry
}

public struct FoundationKineoStorageProtector: KineoStorageProtecting {
    public init() {}

    public func preparePrivateDirectory(at url: URL) throws {
        try FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        try protectItem(at: url)
    }

    public func protectItem(at url: URL) throws {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.complete],
            ofItemAtPath: url.path
        )
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableURL = url
        try mutableURL.setResourceValues(values)
        let audit = try auditItem(at: url)
        #if os(iOS) && !targetEnvironment(simulator)
        guard audit.hasCompleteProtection, audit.isExcludedFromBackup else {
            throw CocoaError(.fileWriteUnknown)
        }
        #else
        guard audit.isExcludedFromBackup else {
            throw CocoaError(.fileWriteUnknown)
        }
        #endif
    }

    public func auditItem(at url: URL) throws -> KineoStorageAuditEntry {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let protection = attributes[.protectionKey] as? FileProtectionType
        let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
        return KineoStorageAuditEntry(
            url: url,
            hasCompleteProtection: protection == .complete,
            isExcludedFromBackup: values.isExcludedFromBackup == true
        )
    }
}

/// Test adapter for host-side SQLite tests. App-hosted tests use
/// `FoundationKineoStorageProtector` to inspect real iOS resource attributes.
public struct NoOpKineoStorageProtector: KineoStorageProtecting {
    public init() {}

    public func preparePrivateDirectory(at url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    public func protectItem(at url: URL) throws {}

    public func auditItem(at url: URL) throws -> KineoStorageAuditEntry {
        KineoStorageAuditEntry(
            url: url,
            hasCompleteProtection: true,
            isExcludedFromBackup: true
        )
    }
}

public struct KineoStoreLocation: Equatable, Sendable {
    public let applicationSupportURL: URL
    public let privateDirectoryName: String
    public let databaseFileName: String
    public let deletionMarkerName: String

    public init(
        applicationSupportURL: URL,
        privateDirectoryName: String = "KineoPrivate",
        databaseFileName: String = "kineo.sqlite",
        deletionMarkerName: String = "KineoDeletionPending"
    ) {
        self.applicationSupportURL = applicationSupportURL
        self.privateDirectoryName = privateDirectoryName
        self.databaseFileName = databaseFileName
        self.deletionMarkerName = deletionMarkerName
    }

    public var privateDirectoryURL: URL {
        applicationSupportURL.appending(path: privateDirectoryName, directoryHint: .isDirectory)
    }

    public var databaseURL: URL {
        privateDirectoryURL.appending(path: databaseFileName, directoryHint: .notDirectory)
    }

    public var deletionMarkerURL: URL {
        applicationSupportURL.appending(path: deletionMarkerName, directoryHint: .notDirectory)
    }

    public var databaseSidecarURLs: [URL] {
        [databaseURL, URL(fileURLWithPath: databaseURL.path + "-wal"), URL(fileURLWithPath: databaseURL.path + "-shm")]
    }
}
