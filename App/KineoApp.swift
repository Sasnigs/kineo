import KineoInfrastructure
import KineoUI
import SwiftUI

@main
struct KineoApp: App {
    private let productService = PrototypeProductService()

    var body: some Scene {
        WindowGroup {
            KineoRootView(productService: productService)
        }
    }
}
