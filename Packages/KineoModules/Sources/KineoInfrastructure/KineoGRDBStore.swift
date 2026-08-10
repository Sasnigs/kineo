import Foundation
import GRDB
import KineoCore

public actor KineoGRDBStore {
    public nonisolated let location: KineoStoreLocation

    private let protectedData: any KineoProtectedDataAvailability
    private let storageProtector: any KineoStorageProtecting
    private let failure: KineoStoreFailureInjection
    private var databaseQueue: DatabaseQueue?
    private var isDeleted = false
    private var isDeletionPending = false
    private var isProtectionCompromised = false

    private init(
        location: KineoStoreLocation,
        protectedData: any KineoProtectedDataAvailability,
        storageProtector: any KineoStorageProtecting,
        failure: KineoStoreFailureInjection,
        databaseQueue: DatabaseQueue
    ) {
        self.location = location
        self.protectedData = protectedData
        self.storageProtector = storageProtector
        self.failure = failure
        self.databaseQueue = databaseQueue
    }

    public static func open(
        location: KineoStoreLocation,
        protectedData: any KineoProtectedDataAvailability = AlwaysAvailableProtectedData(),
        storageProtector: any KineoStorageProtecting = FoundationKineoStorageProtector(),
        failure: KineoStoreFailureInjection = .none
    ) async throws -> KineoGRDBStore {
        guard await protectedData.isProtectedDataAvailable() else {
            throw KineoPersistenceFailure.protectedDataUnavailable
        }

        try FileManager.default.createDirectory(
            at: location.applicationSupportURL,
            withIntermediateDirectories: true
        )

        if FileManager.default.fileExists(atPath: location.deletionMarkerURL.path) {
            try resumeDeletion(
                location: location,
                storageProtector: storageProtector,
                failure: failure
            )
            throw KineoPersistenceFailure.deletedStore
        }

        do {
            try storageProtector.preparePrivateDirectory(at: location.privateDirectoryURL)
            try protectExistingOwnedItems(location: location, storageProtector: storageProtector)
        } catch {
            throw KineoPersistenceFailure.protectionFailed
        }

        var configuration = Configuration()
        configuration.foreignKeysEnabled = true
        configuration.journalMode = .wal

        let queue: DatabaseQueue
        do {
            queue = try DatabaseQueue(path: location.databaseURL.path, configuration: configuration)
            try await queue.read { db in try KineoDatabaseSchema.preflight(db) }
            let migrator = KineoDatabaseSchema.migrator(failure: failure)
            try migrator.migrate(queue)
            try await queue.read { db in try KineoDatabaseSchema.preflight(db) }
        } catch {
            do {
                try protectExistingOwnedItems(location: location, storageProtector: storageProtector)
            } catch {
                throw KineoPersistenceFailure.protectionFailed
            }
            if let failure = error as? KineoPersistenceFailure {
                throw failure
            }
            if let databaseError = error as? DatabaseError,
               databaseError.extendedResultCode == .SQLITE_CORRUPT ||
                databaseError.extendedResultCode == .SQLITE_NOTADB {
                throw KineoPersistenceFailure.corruptStore
            }
            throw KineoPersistenceFailure.migrationFailed
        }

        do {
            try protectExistingOwnedItems(location: location, storageProtector: storageProtector)
        } catch {
            throw KineoPersistenceFailure.protectionFailed
        }

        return KineoGRDBStore(
            location: location,
            protectedData: protectedData,
            storageProtector: storageProtector,
            failure: failure,
            databaseQueue: queue
        )
    }

    public func storageAudit() throws -> [KineoStorageAuditEntry] {
        var urls = [location.privateDirectoryURL]
        urls.append(contentsOf: location.databaseSidecarURLs.filter {
            FileManager.default.fileExists(atPath: $0.path)
        })
        if FileManager.default.fileExists(atPath: location.deletionMarkerURL.path) {
            urls.append(location.deletionMarkerURL)
        }
        return try urls.map { try storageProtector.auditItem(at: $0) }
    }

    func read<T: Sendable>(
        _ body: @Sendable (Database) throws -> T
    ) throws -> T {
        guard !isProtectionCompromised else {
            throw KineoPersistenceFailure.protectionFailed
        }
        guard !isDeleted, !isDeletionPending, let databaseQueue else {
            throw KineoPersistenceFailure.deletedStore
        }
        guard try protectedDataIsSynchronouslyAvailableForOperation() else {
            throw KineoPersistenceFailure.protectedDataUnavailable
        }
        do {
            return try databaseQueue.read(body)
        } catch let error as KineoPersistenceFailure {
            throw error
        } catch {
            throw Self.mapDatabaseFailure(error, writing: false)
        }
    }

    func transaction<T: Sendable>(
        name: String,
        _ body: @Sendable (Database) throws -> T
    ) throws -> T {
        guard !isProtectionCompromised else {
            throw KineoPersistenceFailure.protectionFailed
        }
        guard !isDeleted, !isDeletionPending, let databaseQueue else {
            throw KineoPersistenceFailure.deletedStore
        }
        guard try protectedDataIsSynchronouslyAvailableForOperation() else {
            throw KineoPersistenceFailure.protectedDataUnavailable
        }
        do {
            let result = try databaseQueue.write { db in
                let value = try body(db)
                try failure.check(.transactionBeforeCommit(name))
                return value
            }
            do {
                try Self.protectExistingOwnedItems(location: location, storageProtector: storageProtector)
            } catch {
                isProtectionCompromised = true
                self.databaseQueue = nil
                do {
                    try databaseQueue.close()
                } catch {
                    throw KineoPersistenceFailure.protectionFailed
                }
                throw KineoPersistenceFailure.protectionFailed
            }
            return result
        } catch let error as KineoPersistenceFailure {
            throw error
        } catch {
            throw Self.mapDatabaseFailure(error, writing: true)
        }
    }

    private func protectedDataIsSynchronouslyAvailableForOperation() throws -> Bool {
        // All public store methods are async through the Core port. They perform the
        // asynchronous availability check before entering these synchronous helpers.
        true
    }

    func requireProtectedData() async throws {
        guard await protectedData.isProtectedDataAvailable() else {
            throw KineoPersistenceFailure.protectedDataUnavailable
        }
    }

    func mapOperationError(_ error: any Error) async -> KineoCore.PersistenceError {
        guard await protectedData.isProtectedDataAvailable() else {
            return .protectedDataUnavailable
        }
        return Self.mapPersistenceError(error)
    }

    func closeForDeletion() throws {
        try databaseQueue?.close()
        databaseQueue = nil
    }

    func performVerifiedDeletion() throws {
        guard !isDeleted else { return }
        isDeletionPending = true
        do {
            if !FileManager.default.fileExists(atPath: location.deletionMarkerURL.path) {
                try Data("deletion-pending".utf8).write(
                    to: location.deletionMarkerURL,
                    options: [.atomic]
                )
            }
            try storageProtector.protectItem(at: location.deletionMarkerURL)
            try failure.check(.deletionAfterMarker)
            try closeForDeletion()
            try failure.check(.deletionAfterClose)
            if FileManager.default.fileExists(atPath: location.privateDirectoryURL.path) {
                try FileManager.default.removeItem(at: location.privateDirectoryURL)
            }
            try failure.check(.deletionAfterPrivateDirectory)
            guard !FileManager.default.fileExists(atPath: location.privateDirectoryURL.path) else {
                throw KineoPersistenceFailure.deletionFailed
            }
            if FileManager.default.fileExists(atPath: location.deletionMarkerURL.path) {
                try FileManager.default.removeItem(at: location.deletionMarkerURL)
            }
            guard !FileManager.default.fileExists(atPath: location.deletionMarkerURL.path) else {
                throw KineoPersistenceFailure.deletionFailed
            }
            isDeleted = true
            isDeletionPending = false
        } catch let error as KineoPersistenceFailure {
            throw error
        } catch {
            throw KineoPersistenceFailure.deletionFailed
        }
    }

    private static func resumeDeletion(
        location: KineoStoreLocation,
        storageProtector: any KineoStorageProtecting,
        failure: KineoStoreFailureInjection
    ) throws {
        do {
            try storageProtector.protectItem(at: location.deletionMarkerURL)
            if FileManager.default.fileExists(atPath: location.privateDirectoryURL.path) {
                try FileManager.default.removeItem(at: location.privateDirectoryURL)
            }
            try failure.check(.deletionAfterPrivateDirectory)
            guard !FileManager.default.fileExists(atPath: location.privateDirectoryURL.path) else {
                throw KineoPersistenceFailure.deletionFailed
            }
            try FileManager.default.removeItem(at: location.deletionMarkerURL)
        } catch let error as KineoPersistenceFailure {
            throw error
        } catch {
            throw KineoPersistenceFailure.deletionFailed
        }
    }

    private static func protectExistingOwnedItems(
        location: KineoStoreLocation,
        storageProtector: any KineoStorageProtecting
    ) throws {
        try storageProtector.protectItem(at: location.privateDirectoryURL)
        for url in location.databaseSidecarURLs where FileManager.default.fileExists(atPath: url.path) {
            try storageProtector.protectItem(at: url)
        }
    }

    static func mapDatabaseFailure(_ error: any Error, writing: Bool) -> KineoPersistenceFailure {
        guard let databaseError = error as? DatabaseError else {
            return writing ? .writeFailed : .readFailed
        }
        switch databaseError.extendedResultCode.primaryResultCode {
        case .SQLITE_CONSTRAINT:
            return .constraint
        case .SQLITE_CORRUPT, .SQLITE_NOTADB:
            return .corruptStore
        case .SQLITE_FULL, .SQLITE_IOERR, .SQLITE_READONLY:
            return writing ? .writeFailed : .readFailed
        default:
            return writing ? .writeFailed : .readFailed
        }
    }

    static func mapPersistenceError(_ error: any Error) -> KineoCore.PersistenceError {
        switch error as? KineoPersistenceFailure {
        case .protectedDataUnavailable: .protectedDataUnavailable
        case let .futureSchema(version): .futureSchema(found: version, supported: KineoDatabaseSchema.currentVersion)
        case .migrationIntegrity: .migrationIntegrityFailure
        case .migrationFailed: .migrationFailed
        case .injectedFailure: .writeFailed
        case .corruptStore: .corruptedStore
        case .constraint: .constraintViolation(.domainInvariant)
        case .notFound: .recordNotFound
        case .conflict: .conflictingWrite
        case .invalidTransition: .invalidLifecycleTransition
        case .readFailed: .readFailed
        case .writeFailed: .writeFailed
        case .protectionFailed: .storageProtectionFailed
        case .deletionFailed: .deletionFailed
        case .deletedStore: .storeDeleted
        case nil: .writeFailed
        }
    }
}
