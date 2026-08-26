import Foundation
import KineoInfrastructure
import KineoUI
import SwiftUI

#if KINEO_RELEASE_CANDIDATE || KINEO_RELEASE
// Temporary until M11 supplies a production catalog composition root. Per-record
// eligibility remains enforced by CatalogValidator; this prevents accidental packaging.
#error("KINEO-PRODUCTION-CONTENT-REQUIRED: release builds cannot include the internal prototype catalog.")
#endif

@main
struct KineoApp: App {
    private let productService: PrototypeProductService

    init() {
        #if KINEO_PROTOTYPE
        if let isolatedLocation = KineoUITestLaunchConfiguration.isolatedStoreLocation() {
            productService = PrototypeProductService(location: isolatedLocation)
            return
        }
        #endif
        productService = PrototypeProductService()
    }

    var body: some Scene {
        WindowGroup {
            KineoRootView(productService: productService)
        }
    }
}

#if KINEO_PROTOTYPE
private enum KineoUITestLaunchConfiguration {
    private static let runIdentifierEnvironmentKey = "KINEO_UI_TEST_RUN_ID"
    private static let directoryPrefix = "KineoUITests-"

    static func isolatedStoreLocation() -> KineoStoreLocation? {
        guard let rawIdentifier = ProcessInfo.processInfo.environment[runIdentifierEnvironmentKey],
              let runIdentifier = UUID(uuidString: rawIdentifier) else {
            return nil
        }
        let directory = FileManager.default.temporaryDirectory.appending(
            path: directoryPrefix + runIdentifier.uuidString.lowercased(),
            directoryHint: .isDirectory
        )
        return KineoStoreLocation(applicationSupportURL: directory)
    }
}
#endif
