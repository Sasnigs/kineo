import KineoCore
@testable import KineoUI
import XCTest

final class KineoRootViewTests: XCTestCase {
    @MainActor
    func testRootViewAcceptsCoreLaunchState() {
        _ = KineoRootView(launchState: .foundationReady)
        _ = KineoRootView(launchState: .preparingFoundation)
        _ = KineoRootView(launchState: .protectedDataUnavailable)
        _ = KineoRootView(launchState: .foundationUnavailable)
    }

    func testOnboardingProgressUsesNamedStages() {
        let expectedStages: [(KineoOnboardingStage, Int, String)] = [
            (.eligibility, 1, "Step 1 of 4"),
            (.primaryArea, 2, "Step 2 of 4"),
            (.secondaryArea, 3, "Step 3 of 4"),
            (.safety, 4, "Step 4 of 4")
        ]

        for (stage, expectedCurrent, expectedValue) in expectedStages {
            let progress = KineoFlowProgress.onboarding(stage: stage)
            XCTAssertEqual(progress.current, expectedCurrent)
            XCTAssertEqual(progress.total, expectedStages.count)
            XCTAssertEqual(progress.valueText, expectedValue)
        }
    }

    func testCheckInProgressUsesNamedQuestions() {
        let expectedQuestions: [(KineoCheckInQuestion, Int, String)] = [
            (.change, 1, "Question 1 of 2"),
            (.movementComfort, 2, "Question 2 of 2")
        ]

        for (question, expectedCurrent, expectedValue) in expectedQuestions {
            let progress = KineoFlowProgress.checkIn(question: question)
            XCTAssertEqual(progress.current, expectedCurrent)
            XCTAssertEqual(progress.total, expectedQuestions.count)
            XCTAssertEqual(progress.valueText, expectedValue)
        }
    }
}
