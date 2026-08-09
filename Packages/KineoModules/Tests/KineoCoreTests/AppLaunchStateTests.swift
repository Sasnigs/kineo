import KineoCore
import XCTest

final class AppLaunchStateTests: XCTestCase {
    func testFoundationStateIsStable() {
        XCTAssertEqual(AppLaunchState.foundationReady, .foundationReady)
    }
}

