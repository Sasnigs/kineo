import Foundation
import XCTest

final class DependencyBoundaryTests: XCTestCase {
    func testPackageDependencyGraphPointsInward() throws {
        let manifest = try String(
            contentsOf: packageRoot.appending(path: "Package.swift"),
            encoding: .utf8
        )

        XCTAssertTrue(manifest.contains("name: \"KineoInfrastructure\""))
        XCTAssertTrue(manifest.contains(".product(name: \"GRDB\", package: \"GRDB.swift\")"))
        XCTAssertTrue(manifest.contains("name: \"KineoUI\",\n            dependencies: [\"KineoCore\"]"))
        XCTAssertFalse(manifest.contains("name: \"KineoCore\",\n            dependencies:"))
    }

    func testCoreHasNoOutwardFrameworkImports() throws {
        try assertNoImports(
            in: packageRoot.appending(path: "Sources/KineoCore"),
            forbidden: ["SwiftUI", "GRDB", "HealthKit", "UserNotifications", "AVKit", "Network", "SQLite3"]
        )
    }

    func testUIHasNoInfrastructureOrDataImports() throws {
        try assertNoImports(
            in: packageRoot.appending(path: "Sources/KineoUI"),
            forbidden: ["KineoInfrastructure", "GRDB", "HealthKit", "UserNotifications", "AVKit", "Network", "SQLite3"]
        )
    }

    func testInfrastructureDoesNotDependOnUIOrNetworking() throws {
        try assertNoImports(
            in: packageRoot.appending(path: "Sources/KineoInfrastructure"),
            forbidden: ["KineoUI", "SwiftUI", "HealthKit", "Network"]
        )
    }

    func testCapabilitiesAreDenyByDefault() throws {
        let project = try String(
            contentsOf: repositoryRoot.appending(path: "Kineo.xcodeproj/project.pbxproj"),
            encoding: .utf8
        )
        let baseConfiguration = try String(
            contentsOf: repositoryRoot.appending(path: "Configurations/Base.xcconfig"),
            encoding: .utf8
        )

        XCTAssertFalse(project.contains("SystemCapabilities"))
        XCTAssertFalse(project.contains("CODE_SIGN_ENTITLEMENTS"))
        XCTAssertFalse(project.contains("HealthKit.framework"))
        XCTAssertFalse(project.contains("Network.framework"))
        XCTAssertTrue(baseConfiguration.contains("KINEO_HEALTHKIT_ENABLED = NO"))
        XCTAssertTrue(baseConfiguration.contains("KINEO_TELEMETRY_ENABLED = NO"))
        XCTAssertTrue(baseConfiguration.contains("KINEO_NETWORK_CLIENT_ENABLED = NO"))
    }

    func testAppIsOnlyTheCompositionRoot() throws {
        let source = try String(
            contentsOf: repositoryRoot.appending(path: "App/KineoApp.swift"),
            encoding: .utf8
        )

        XCTAssertTrue(source.contains("import KineoUI"))
        XCTAssertTrue(source.contains("import KineoInfrastructure"))
        XCTAssertFalse(source.contains("import KineoCore"))
    }

    private var packageRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private var repositoryRoot: URL {
        packageRoot
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func assertNoImports(in directory: URL, forbidden: [String]) throws {
        let sourceFiles = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        ).filter { $0.pathExtension == "swift" }

        for sourceFile in sourceFiles {
            let source = try String(contentsOf: sourceFile, encoding: .utf8)
            for module in forbidden {
                XCTAssertFalse(
                    source.contains("import \(module)"),
                    "\(sourceFile.lastPathComponent) must not import \(module)"
                )
            }
        }
    }
}
