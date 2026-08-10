import KineoInfrastructure
import KineoUI
import SwiftUI

@main
struct KineoApp: App {
    private let bootstrapper = PrototypeBootstrapper()

    var body: some Scene {
        WindowGroup {
            KineoRootView(bootstrapper: bootstrapper)
        }
    }
}
