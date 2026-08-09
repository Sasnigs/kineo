@testable import KineoApp
import XCTest

final class KineoAppTests: XCTestCase {
    @MainActor
    func testCompositionRootCanBeCreated() {
        _ = KineoApp()
    }
}

