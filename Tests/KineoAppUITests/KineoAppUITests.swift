import XCTest

final class KineoAppUITests: XCTestCase {
    private static let elementTimeout: TimeInterval = 10
    private static let maximumScrollAttempts = 12
    private static let runIdentifierEnvironmentKey = "KINEO_UI_TEST_RUN_ID"
    private static let preferredContentSizeArgument = "-UIPreferredContentSizeCategoryName"
    private static let maximumContentSizeCategory = "UICTContentSizeCategoryAccessibilityXXXL"
    private static let interfaceStyleArgument = "-AppleInterfaceStyle"
    private static let darkInterfaceStyle = "Dark"
    private static let reduceMotionArgument = "-UIAccessibilityReduceMotionEnabled"
    private static let enabledArgumentValue = "YES"
    private static let doubleLocalizedStringsArgument = "-NSDoubleLocalizedStrings"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testMaximumTextSupportsOnboardingProfileAndDeletionScope() throws {
        let app = makeApplication(additionalArguments: [
            Self.preferredContentSizeArgument,
            Self.maximumContentSizeCategory
        ])
        app.launch()

        XCTAssertTrue(app.staticTexts["Movement for how today feels"].waitForExistence(
            timeout: Self.elementTimeout
        ))
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)
        completeOnboarding(in: app, secondaryArea: nil)

        tap(app.tabBars.buttons["Profile"], in: app)
        XCTAssertTrue(app.staticTexts["Areas"].waitForExistence(timeout: Self.elementTimeout))
        tap(element(in: app.buttons, containing: "Areas"), in: app)
        tap(element(in: app.buttons, containing: "Privacy and data"), in: app)
        tap(app.buttons["Delete all Kineo data"], in: app)
        XCTAssertTrue(app.staticTexts["Delete all Kineo data?"].waitForExistence(
            timeout: Self.elementTimeout
        ))
        XCTAssertTrue(app.staticTexts["You will return to onboarding."].exists)
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)
    }

    @MainActor
    func testExpandedLocalizationPreservesOnboardingControls() throws {
        let app = makeApplication(additionalArguments: [
            Self.doubleLocalizedStringsArgument,
            Self.enabledArgumentValue
        ])
        app.launch()

        let welcomeText = "Movement for how today feels"
        let welcome = element(in: app.staticTexts, containing: welcomeText)
        XCTAssertTrue(welcome.waitForExistence(timeout: Self.elementTimeout))
        XCTAssertGreaterThan(welcome.label.count, welcomeText.count)
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)

        tap(element(in: app.buttons, containing: "Get started"), in: app)
        tap(element(in: app.buttons, containing: "Yes, I am 18 or older"), in: app)
        XCTAssertTrue(element(in: app.staticTexts, containing: "Choose your main area")
            .waitForExistence(timeout: Self.elementTimeout))
        XCTAssertTrue(element(in: app.buttons, containing: "Upper or mid-back").isHittable)
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)
    }

    @MainActor
    func testSafetyBranchIsAccessibleAndWithholdsRoutine() throws {
        let app = makeApplication()
        app.launch()
        completeOnboarding(in: app, secondaryArea: nil)

        tap(app.buttons["Start today's check-in"], in: app)
        tap(app.buttons["Worse"], in: app)
        tap(app.buttons["Okay"], in: app)
        XCTAssertTrue(app.staticTexts["One follow-up for neck"].waitForExistence(
            timeout: Self.elementTimeout
        ))
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)
        tap(app.buttons["Yes"], in: app)
        XCTAssertTrue(app.staticTexts["Attention required"].waitForExistence(
            timeout: Self.elementTimeout
        ))
        XCTAssertFalse(app.buttons["Start routine"].exists)
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)
    }

    @MainActor
    func testTwoAreaRoutineInterruptionReturnsPausedWithoutAutoResume() throws {
        let app = makeApplication(additionalArguments: [
            Self.interfaceStyleArgument,
            Self.darkInterfaceStyle,
            Self.reduceMotionArgument,
            Self.enabledArgumentValue
        ])
        app.launch()
        completeOnboarding(in: app, secondaryArea: "Lower back")

        tap(app.buttons["Start today's check-in"], in: app)
        answerSimilarAndOkay(in: app)
        answerSimilarAndOkay(in: app)
        XCTAssertTrue(app.staticTexts["Your plan"].waitForExistence(timeout: Self.elementTimeout))
        tap(app.buttons["Start routine"], in: app)
        XCTAssertTrue(app.staticTexts["Guided routine"].waitForExistence(timeout: Self.elementTimeout))
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)

        tap(app.buttons["Something feels wrong"], in: app)
        XCTAssertTrue(app.staticTexts["Stop and check how you feel"].waitForExistence(
            timeout: Self.elementTimeout
        ))
        tap(app.buttons["I tapped this by mistake"], in: app)
        XCTAssertTrue(app.staticTexts["Paused"].waitForExistence(timeout: Self.elementTimeout))
        XCTAssertTrue(app.buttons["Resume"].isHittable)
        XCTAssertFalse(app.buttons["Complete step"].exists)
    }

    @MainActor
    private func makeApplication(additionalArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment[Self.runIdentifierEnvironmentKey] = UUID().uuidString
        app.launchArguments.append(contentsOf: additionalArguments)
        return app
    }

    @MainActor
    private func completeOnboarding(in app: XCUIApplication, secondaryArea: String?) {
        XCTAssertTrue(app.buttons["Get started"].waitForExistence(timeout: Self.elementTimeout))
        tap(app.buttons["Get started"], in: app)
        tap(app.buttons["Yes, I am 18 or older"], in: app)
        tap(app.buttons["Neck"], in: app)
        tap(app.buttons["Continue"], in: app)
        if let secondaryArea {
            tap(app.buttons[secondaryArea], in: app)
        } else {
            tap(app.buttons["No secondary area"], in: app)
        }
        tap(app.buttons["Continue"], in: app)
        tap(app.buttons["I understand"], in: app)
        tap(app.buttons["Check in for today"], in: app)
        XCTAssertTrue(app.staticTexts["Today"].waitForExistence(timeout: Self.elementTimeout))
    }

    @MainActor
    private func answerSimilarAndOkay(in app: XCUIApplication) {
        tap(app.buttons["Similar"], in: app)
        tap(app.buttons["Okay"], in: app)
    }

    @MainActor
    private func tap(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: Self.elementTimeout))
        var attempts = 0
        while !element.isHittable && attempts < Self.maximumScrollAttempts {
            app.swipeUp()
            attempts += 1
        }
        XCTAssertTrue(element.isHittable)
        element.tap()
    }

    @MainActor
    private func element(
        in query: XCUIElementQuery,
        containing visibleText: String
    ) -> XCUIElement {
        query.matching(NSPredicate(format: "label CONTAINS %@", visibleText)).firstMatch
    }

    private static let commonAuditTypes: XCUIAccessibilityAuditType = [
        .dynamicType,
        .elementDetection,
        .hitRegion,
        .sufficientElementDescription,
        .textClipped,
        .trait
    ]
}
