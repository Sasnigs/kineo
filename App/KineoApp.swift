import Foundation
import KineoInfrastructure
import KineoUI
import SwiftUI

@main
struct KineoApp: App {
    private let productService: PrototypeProductService

    init() {
        #if DEBUG
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

#if DEBUG
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
