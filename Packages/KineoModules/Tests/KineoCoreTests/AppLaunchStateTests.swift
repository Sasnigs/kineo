import KineoCore
import XCTest

final class AppLaunchStateTests: XCTestCase {
    func testLaunchStatesAreDistinct() {
        XCTAssertEqual(AppLaunchState.foundationReady, .foundationReady)
        XCTAssertNotEqual(AppLaunchState.preparingFoundation, .foundationReady)
        XCTAssertNotEqual(AppLaunchState.protectedDataUnavailable, .foundationUnavailable)
    }
}
