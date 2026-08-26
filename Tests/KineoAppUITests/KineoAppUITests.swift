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
    private static let increaseContrastArgument = "-UIAccessibilityDarkerSystemColorsEnabled"
    private static let differentiateWithoutColorArgument = "-UIAccessibilityDifferentiateWithoutColor"
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
        attachScreenshot(named: "Welcome — maximum text", from: app)
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)
        completeOnboarding(in: app, secondaryArea: nil)

        tap(app.tabBars.buttons["Progress"], in: app)
        XCTAssertTrue(app.staticTexts["No history yet"].waitForExistence(
            timeout: Self.elementTimeout
        ))
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)

        tap(app.tabBars.buttons["Profile"], in: app)
        XCTAssertTrue(app.staticTexts["Areas"].waitForExistence(timeout: Self.elementTimeout))
        attachScreenshot(named: "Profile — maximum text", from: app)
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
    func testAdaptiveSettingsSupportPlanAndRoutine() throws {
        let app = makeApplication(additionalArguments: [
            Self.preferredContentSizeArgument,
            Self.maximumContentSizeCategory,
            Self.increaseContrastArgument,
            Self.enabledArgumentValue,
            Self.differentiateWithoutColorArgument,
            Self.enabledArgumentValue,
            Self.reduceMotionArgument,
            Self.enabledArgumentValue
        ])
        app.launch()
        completeOnboarding(in: app, secondaryArea: "Lower back")

        tap(app.buttons["Start today's check-in"], in: app)
        answerSimilarAndOkay(in: app)
        answerSimilarAndOkay(in: app)
        XCTAssertTrue(app.staticTexts["Your plan"].waitForExistence(timeout: Self.elementTimeout))
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)

        tap(app.buttons["Start routine"], in: app)
        XCTAssertTrue(app.staticTexts["Guided routine"].waitForExistence(
            timeout: Self.elementTimeout
        ))
        let routineDose = app.descendants(matching: .any)["Routine dose"]
        XCTAssertTrue(routineDose.waitForExistence(
            timeout: Self.elementTimeout
        ))
        let doseAnnouncement = try XCTUnwrap(routineDose.value as? String)
        XCTAssertTrue(doseAnnouncement.contains(". "))
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
    func testWelcomeAndCheckInExposeClearProgress() {
        let app = makeApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["Kineo"].waitForExistence(
            timeout: Self.elementTimeout
        ))
        attachScreenshot(named: "Welcome", from: app)
        completeOnboarding(in: app, secondaryArea: nil)
        attachScreenshot(named: "Today", from: app)
        tap(app.tabBars.buttons["Progress"], in: app)
        attachScreenshot(named: "Progress", from: app)
        tap(app.tabBars.buttons["Profile"], in: app)
        attachScreenshot(named: "Profile", from: app)
        tap(app.tabBars.buttons["Today"], in: app)
        tap(app.buttons["Start today's check-in"], in: app)

        let progress = app.descendants(matching: .any)["Check-in progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: Self.elementTimeout))
        XCTAssertEqual(progress.value as? String, "Question 1 of 2")

        tap(choiceButton(named: "Similar", in: app), in: app)
        XCTAssertEqual(progress.value as? String, "Question 2 of 2")
    }

    @MainActor
    func testSafetyBranchIsAccessibleAndWithholdsRoutine() throws {
        let app = makeApplication()
        app.launch()
        completeOnboarding(in: app, secondaryArea: nil)

        tap(app.buttons["Start today's check-in"], in: app)
        tap(choiceButton(named: "Worse", in: app), in: app)
        tap(choiceButton(named: "Okay", in: app), in: app)
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
    func testPrototypeStartOverReturnsToWelcome() throws {
        let app = makeApplication()
        app.launch()
        completeOnboarding(in: app, secondaryArea: nil)

        let uiEvidence = XCTAttachment(screenshot: app.screenshot())
        uiEvidence.name = "Prototype start-over control"
        uiEvidence.lifetime = .keepAlways
        add(uiEvidence)

        tap(app.buttons["Start over for testing"], in: app)
        XCTAssertTrue(app.staticTexts["Delete all Kineo data?"].waitForExistence(
            timeout: Self.elementTimeout
        ))
        try app.performAccessibilityAudit(for: Self.commonAuditTypes)

        tap(app.buttons["Delete all data"], in: app)
        XCTAssertTrue(app.staticTexts["Movement for how today feels"].waitForExistence(
            timeout: Self.elementTimeout
        ))
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
        attachScreenshot(named: "Plan", from: app)
        tap(app.buttons["Start routine"], in: app)
        XCTAssertTrue(app.staticTexts["Guided routine"].waitForExistence(timeout: Self.elementTimeout))
        XCTAssertTrue(app.otherElements["Prototype movement preview"].waitForExistence(
            timeout: Self.elementTimeout
        ))
        attachScreenshot(named: "Routine", from: app)
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
        tap(choiceButton(named: "Neck", in: app), in: app)
        tap(app.buttons["Continue"], in: app)
        if let secondaryArea {
            tap(choiceButton(named: secondaryArea, in: app), in: app)
        } else {
            tap(choiceButton(named: "No secondary area", in: app), in: app)
        }
        tap(app.buttons["Continue"], in: app)
        tap(app.buttons["I understand"], in: app)
        tap(app.buttons["Check in for today"], in: app)
        XCTAssertTrue(app.staticTexts["Today"].waitForExistence(timeout: Self.elementTimeout))
    }

    @MainActor
    private func answerSimilarAndOkay(in app: XCUIApplication) {
        tap(choiceButton(named: "Similar", in: app), in: app)
        tap(choiceButton(named: "Okay", in: app), in: app)
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

    @MainActor
    private func choiceButton(named visibleTitle: String, in app: XCUIApplication) -> XCUIElement {
        element(in: app.buttons, containing: visibleTitle)
    }

    @MainActor
    private func attachScreenshot(named name: String, from app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
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
