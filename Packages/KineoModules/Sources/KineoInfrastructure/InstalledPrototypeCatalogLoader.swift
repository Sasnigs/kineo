import CryptoKit
import Foundation
import KineoCore

/// Failures while loading and verifying the bundled prototype catalog.
public enum InstalledPrototypeCatalogError: Error, Equatable, Sendable {
    case assetMissing(String)
    case assetUnreadable(String)
    case invalidDigest(String)
    case catalogInvalid(CatalogValidationError)
}

/// A validated catalog paired with evidence from its installed resources.
public struct InstalledPrototypeCatalog: Sendable {
    public let catalog: RoutineCatalog
    public let resources: CatalogValidationResources

    public init(catalog: RoutineCatalog, resources: CatalogValidationResources) {
        self.catalog = catalog
        self.resources = resources
    }
}

/// Injectable boundary for loading the currently installed prototype catalog.
public protocol InstalledPrototypeCatalogProviding: Sendable {
    func load() async throws(InstalledPrototypeCatalogError) -> InstalledPrototypeCatalog
}

/// Production adapter for the catalog bundled with KineoModules.
public struct BundledInstalledPrototypeCatalogProvider: InstalledPrototypeCatalogProviding {
    public init() {}

    public func load() async throws(InstalledPrototypeCatalogError) -> InstalledPrototypeCatalog {
        try InstalledPrototypeCatalogLoader.load()
    }
}

/// Loads the internal catalog only after its bundled asset bytes validate.
public enum InstalledPrototypeCatalogLoader {
    /// Loads and validates the exact prototype catalog bundled with the app modules.
    public static func load() throws(InstalledPrototypeCatalogError) -> InstalledPrototypeCatalog {
        let artifacts: (catalog: RoutineCatalog, expectedAssets: [String: KineoCore.SHA256Digest])
        do {
            artifacts = try prototypeArtifacts()
        } catch {
            throw .catalogInvalid(error)
        }

        var installedAssets = [String: KineoCore.SHA256Digest]()
        for (path, expectedDigest) in artifacts.expectedAssets {
            guard let url = assetURL(for: path) else { throw .assetMissing(path) }
            let bytes: Data
            do {
                bytes = try Data(contentsOf: url)
            } catch {
                throw .assetUnreadable(path)
            }
            let digestText = SHA256.hash(data: bytes)
                .map { String(format: "%02x", $0) }
                .joined()
            let actualDigest: KineoCore.SHA256Digest
            do {
                actualDigest = try KineoCore.SHA256Digest(validating: digestText)
            } catch {
                throw .invalidDigest(path)
            }
            guard actualDigest == expectedDigest else { throw .invalidDigest(path) }
            installedAssets[path] = actualDigest
        }

        let resources: CatalogValidationResources
        do {
            resources = try validatedResources(
                for: artifacts.catalog,
                installedAssets: installedAssets
            )
        } catch {
            throw .catalogInvalid(error)
        }
        return InstalledPrototypeCatalog(catalog: artifacts.catalog, resources: resources)
    }

    private static func prototypeArtifacts() throws(CatalogValidationError) -> (
        catalog: RoutineCatalog,
        expectedAssets: [String: KineoCore.SHA256Digest]
    ) {
        (
            catalog: try PrototypeRoutineCatalog.make(),
            expectedAssets: try PrototypeRoutineCatalog.assetDigests()
        )
    }

    private static func validatedResources(
        for catalog: RoutineCatalog,
        installedAssets: [String: KineoCore.SHA256Digest]
    ) throws(CatalogValidationError) -> CatalogValidationResources {
        let resources = CatalogValidationResources(
            localizedStrings: try PrototypeRoutineCatalog.localizedStrings(),
            assetDigestsByPath: installedAssets
        )
        try CatalogValidator.validate(
            catalog,
            for: .internalPrototype,
            resources: resources
        )
        return resources
    }

    private static func assetURL(for path: String) -> URL? {
        let value = path as NSString
        let filename = value.deletingPathExtension
        let fileExtension = value.pathExtension
        let directory = value.deletingLastPathComponent
        return Bundle.module.url(
            forResource: (filename as NSString).lastPathComponent,
            withExtension: fileExtension,
            subdirectory: directory
        )
    }
}
