import KineoCore
import KineoUI
import XCTest

final class KineoRootViewTests: XCTestCase {
    @MainActor
    func testRootViewAcceptsCoreLaunchState() {
        _ = KineoRootView(launchState: .foundationReady)
        _ = KineoRootView(launchState: .preparingFoundation)
        _ = KineoRootView(launchState: .protectedDataUnavailable)
        _ = KineoRootView(launchState: .foundationUnavailable)
    }
}
