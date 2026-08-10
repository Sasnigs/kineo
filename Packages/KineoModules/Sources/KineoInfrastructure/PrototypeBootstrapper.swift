import Foundation
import KineoCore

public actor PrototypeBootstrapper: AppBootstrapping {
    private let location: KineoStoreLocation?
    private let protectedData: any KineoProtectedDataAvailability
    private let storageProtector: any KineoStorageProtecting
    private var store: KineoGRDBStore?

    public init(
        location: KineoStoreLocation? = nil,
        protectedData: (any KineoProtectedDataAvailability)? = nil,
        storageProtector: any KineoStorageProtecting = FoundationKineoStorageProtector()
    ) {
        self.location = location
        #if canImport(UIKit)
        self.protectedData = protectedData ?? SystemProtectedDataAvailability()
        #else
        self.protectedData = protectedData ?? AlwaysAvailableProtectedData()
        #endif
        self.storageProtector = storageProtector
    }

    public func initialState() async -> AppLaunchState {
        guard let resolvedLocation = location ?? Self.defaultLocation() else {
            return .foundationUnavailable
        }
        do {
            let candidate = try await KineoGRDBStore.open(
                location: resolvedLocation,
                protectedData: protectedData,
                storageProtector: storageProtector
            )
            _ = try await candidate.loadSnapshot()
            store = candidate
            return .foundationReady
        } catch KineoPersistenceFailure.deletedStore {
            do {
                let candidate = try await KineoGRDBStore.open(
                    location: resolvedLocation,
                    protectedData: protectedData,
                    storageProtector: storageProtector
                )
                _ = try await candidate.loadSnapshot()
                store = candidate
                return .foundationReady
            } catch KineoPersistenceFailure.protectedDataUnavailable,
                    KineoCore.PersistenceError.protectedDataUnavailable {
                return .protectedDataUnavailable
            } catch {
                return .foundationUnavailable
            }
        } catch KineoPersistenceFailure.protectedDataUnavailable,
                KineoCore.PersistenceError.protectedDataUnavailable {
            return .protectedDataUnavailable
        } catch {
            return .foundationUnavailable
        }
    }

    private static func defaultLocation() -> KineoStoreLocation? {
        guard let applicationSupportURL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            return nil
        }
        return KineoStoreLocation(applicationSupportURL: applicationSupportURL)
    }
}
