import KineoCore
import KineoInfrastructure
import XCTest

final class PrototypeBootstrapperTests: XCTestCase {
    func testBootstrapperProvidesFoundationState() {
        let subject: any AppBootstrapping = PrototypeBootstrapper()

        XCTAssertEqual(subject.initialState(), .foundationReady)
    }
}

