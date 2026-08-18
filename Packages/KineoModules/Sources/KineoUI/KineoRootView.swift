import KineoCore
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public struct KineoRootView: View {
    @State private var model: ProductFlowModel?
    private let fixedLaunchState: AppLaunchState?

    public init(launchState: AppLaunchState) {
        fixedLaunchState = launchState
        _model = State(initialValue: nil)
    }

    public init(productService: any KineoProductServing) {
        fixedLaunchState = nil
        _model = State(initialValue: ProductFlowModel(service: productService))
    }

    public var body: some View {
        if let model {
            ProductFlowContainer(model: model)
        } else {
            LaunchStateView(state: fixedLaunchState ?? .preparingFoundation)
        }
    }
}

private struct ProductFlowContainer: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State var model: ProductFlowModel

    var body: some View {
        NavigationStack {
            Group {
                switch model.state {
                case .launching(let launch): LaunchStateView(state: launch)
                case .welcome: WelcomeView(model: model)
                case .ageConfirmation: AgeConfirmationView(model: model)
                case .ageUnavailable: AgeUnavailableView(model: model)
                case .primaryArea(let selected): PrimaryAreaView(model: model, selected: selected)
                case .secondaryArea(let primary, let selected):
                    SecondaryAreaView(model: model, primary: primary, selected: selected)
                case .safetyBoundary(let area): SafetyBoundaryView(model: model, area: area)
                case .firstCheckIn(let area): FirstCheckInView(model: model, area: area)
                case .today(let area): TodayTabsView(model: model, area: area)
                case .checkInChange(let draft): ChangeCheckInView(model: model, draft: draft)
                case .checkInComfort(let draft, let change):
                    ComfortCheckInView(model: model, draft: draft, change: change)
                case .conditionalSafety(let draft, let change, let comfort):
                    ConditionalSafetyView(model: model, draft: draft, change: change, comfort: comfort)
                case .attentionGuidance(let prompt):
                    AttentionGuidanceView(model: model, prompt: prompt)
                case .attentionReturn(let prompt):
                    AttentionReturnView(model: model, prompt: prompt)
                case .attentionCorrectionChange(_, let draft):
                    AttentionCorrectionChangeView(model: model, draft: draft)
                case .attentionCorrectionComfort(_, let draft, _):
                    AttentionCorrectionComfortView(model: model, draft: draft)
                case .attentionCorrectionSafety(_, let draft, _, _):
                    AttentionCorrectionSafetyView(model: model, draft: draft)
                case .plan(let plan): PlanView(model: model, plan: plan)
                case .pauseTodayConfirmation(let area):
                    PauseTodayConfirmationView(model: model, area: area)
                case .routine(let routine): RoutineView(model: model, routine: routine)
                case .alternativePreview(let routine):
                    AlternativePreviewView(model: model, routine: routine)
                case .endConfirmation(let routine):
                    EndRoutineConfirmationView(model: model, routine: routine)
                case .safetyGuidance(let routine):
                    RoutineSafetyGuidanceView(model: model, routine: routine)
                case .feedback(let routine): FeedbackView(model: model, routine: routine)
                case .completion(let area): CompletionView(model: model, area: area)
                case .resetHistoryConfirmation(let area):
                    ResetHistoryConfirmationView(model: model, area: area)
                case .deleteAllConfirmation:
                    DeleteAllConfirmationView(model: model)
                }
            }
            .disabled(model.isSubmitting)
            .overlay {
                if model.isSubmitting {
                    ProgressView("Saving…")
                        .padding(KineoLayout.sectionSpacing)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: KineoLayout.controlRadius))
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let error = model.errorMessage {
                    ErrorNotice(message: error) { model.send(.retry) }
                }
            }
        }
        .transaction { transaction in
            if reduceMotion { transaction.animation = nil }
        }
        .task(id: model.actionSequence) { await model.performPendingAction() }
        .task(id: model.activeRoutineSessionID) {
            guard model.activeRoutineSessionID != nil else { return }
            await model.refreshActiveRoutineUntilCancelled()
        }
        .task(id: scenePhase) {
            if scenePhase == .active,
               case .launching(let launchState) = model.state,
               launchState != .foundationReady {
                model.send(.load)
            } else if scenePhase == .active, case .today = model.state {
                model.send(.loadDashboard)
            } else if scenePhase != .active {
                await model.pauseActiveRoutineForLifecycle()
            }
        }
        .tint(.accentColor)
    }
}

private struct LaunchStateView: View {
    let state: AppLaunchState

    var body: some View {
        FlowPage(title: "Kineo") {
            Image(systemName: "figure.walk")
                .font(.largeTitle)
                .accessibilityHidden(true)
            Text(message)
        }
    }

    private var message: LocalizedStringKey {
        switch state {
        case .preparingFoundation: "Preparing secure local storage…"
        case .foundationReady: "Local foundation is ready."
        case .protectedDataUnavailable: "Unlock this iPhone to continue."
        case .foundationUnavailable: "Kineo couldn't prepare local storage. Relaunch to try again."
        }
    }
}

private struct WelcomeView: View {
    let model: ProductFlowModel
    var body: some View {
        FlowPage(title: "Movement for how today feels") {
            Text("A short check-in helps Kineo choose one bounded movement routine for today.")
            NoticeCard(title: "Internal prototype", message: "For adults with usual recurring neck or back discomfort. Kineo does not diagnose or treat a condition.")
            PrimaryButton("Get started") { model.send(.getStarted) }
        }
    }
}

private struct AgeConfirmationView: View {
    let model: ProductFlowModel
    var body: some View {
        FlowPage(title: "Are you \(KineoProductCopy.minimumSupportedAge) or older?") {
            Text("Kineo is currently designed for adults. We do not ask for your birth date.")
            PrimaryButton("Yes, I am \(KineoProductCopy.minimumSupportedAge) or older") {
                model.send(.confirmAdult)
            }
            SecondaryButton("No") { model.send(.underAge) }
        }
    }
}

private struct AgeUnavailableView: View {
    let model: ProductFlowModel
    var body: some View {
        FlowPage(title: "Kineo is adults only") {
            Image(systemName: "person.crop.circle.badge.xmark")
                .font(.largeTitle)
                .accessibilityHidden(true)
            Text("This prototype is not available for people under \(KineoProductCopy.minimumSupportedAge).")
            PrimaryButton("Correct my answer") { model.send(.correctAge) }
        }
    }
}

private struct PrimaryAreaView: View {
    let model: ProductFlowModel
    let selected: BodyArea?
    var body: some View {
        FlowPage(title: "Choose your main area") {
            Text("Start with the area you most want help planning movement for.")
            ForEach(BodyArea.allCases, id: \.self) { area in
                ChoiceCard(title: area.localizedTitle, selected: selected == area) { model.send(.selectPrimaryArea(area)) }
            }
            PrimaryButton("Continue") { model.send(.continuePrimaryArea) }
                .disabled(selected == nil)
            if selected == nil {
                Text("Choose one area to continue.").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

private struct SecondaryAreaView: View {
    let model: ProductFlowModel
    let primary: BodyArea
    let selected: BodyArea?

    var body: some View {
        FlowPage(title: "Add another area?") {
            Text("Optional. Your \(primary.title.lowercased()) stays the main focus.")
            ChoiceCard(title: "No secondary area", selected: selected == nil) {
                model.send(.selectSecondaryArea(nil))
            }
            ForEach(BodyArea.allCases.filter { $0 != primary }, id: \.self) { area in
                ChoiceCard(title: area.localizedTitle, selected: selected == area) {
                    model.send(.selectSecondaryArea(area))
                }
            }
            PrimaryButton("Continue") { model.send(.continueSecondaryArea) }
        }
    }
}

private struct SafetyBoundaryView: View {
    let model: ProductFlowModel
    let area: BodyArea
    var body: some View {
        FlowPage(title: "Before your first check-in") {
            Text("Kineo supports self-directed movement planning for your usual recurring \(area.title.lowercased()) discomfort.")
            NoticeCard(
                title: "Pay attention to changes",
                message: "If something feels new, sudden, unusual, or movement feels limited, answer the follow-up honestly. Kineo may withhold a routine.",
                tone: .attention
            )
            Text("Prototype wording requires professional review before use outside the product team.")
                .font(.footnote).foregroundStyle(.secondary)
            PrimaryButton("I understand") { model.send(.acknowledgeSafety) }
        }
    }
}

private struct FirstCheckInView: View {
    let model: ProductFlowModel
    let area: BodyArea
    var body: some View {
        FlowPage(title: "You're ready") {
            Label(area.title, systemImage: "checkmark.circle").font(.title2.weight(.semibold))
            Text("Your normal daily check-in asks only two questions. A follow-up appears only when an answer triggers it.")
            PrimaryButton("Check in for today") { model.send(.completeOnboarding) }
        }
    }
}

private struct TodayTabsView: View {
    let model: ProductFlowModel
    let area: BodyArea
    var body: some View {
        TabView {
            FlowPage(title: "Today") {
                Text(area.title).font(.title2.weight(.semibold))
                Text("Two quick prompts. Your answers select a bounded prototype routine; available time does not change the level.")
                PrimaryButton("Start today's check-in") { model.send(.startCheckIn) }
            }
            .tabItem { Label("Today", systemImage: "sun.max") }
            ProgressTabView(progress: model.progress)
                .tabItem { Label("Progress", systemImage: "chart.line.uptrend.xyaxis") }
            ProfileTabView(model: model)
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .task { model.send(.loadDashboard) }
    }
}

private struct ProgressTabView: View {
    let progress: ProgressPresentation?

    var body: some View {
        FlowPage(title: "Progress") {
            if let progress {
                if progress.isEmpty {
                    NoticeCard(
                        title: "No history yet",
                        message: "Completed routines, intentional stops, and Pause Today participation appear here."
                    )
                } else {
                    Text("\(progress.participationDayCount, format: .number) participation days")
                        .font(.title2.weight(.semibold))
                    ForEach(progress.areas, id: \.area) { area in
                        VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
                            Text(area.area.title).font(.headline)
                            Text("\(area.recordedCheckInCount, format: .number) recorded check-ins")
                            Text("\(area.completedRoutineCount, format: .number) completed routines")
                            Text("\(area.participationCount, format: .number) participation records")
                            if let response = area.latestResponse {
                                Text("Latest response: \(response.title)")
                            }
                        }
                        .cardStyle()
                    }
                }
                Text("These are your local records, not a measure of recovery or a causal claim.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                ProgressView("Loading local progress…")
            }
        }
    }
}

private struct ProfileTabView: View {
    @Environment(\.openURL) private var openURL
    let model: ProductFlowModel

    var body: some View {
        FlowPage(title: "Profile") {
            if let profile = model.profile {
                Text("Areas").font(.title2.weight(.semibold))
                Text("Primary").font(.headline)
                ForEach(BodyArea.allCases, id: \.self) { area in
                    ChoiceCard(title: area.localizedTitle, selected: model.profileDraftPrimary == area) {
                        model.send(.selectProfilePrimary(area))
                    }
                }
                Text("Optional secondary").font(.headline)
                ChoiceCard(title: "None", selected: model.profileDraftSecondary == nil) {
                    model.send(.selectProfileSecondary(nil))
                }
                ForEach(BodyArea.allCases.filter { $0 != model.profileDraftPrimary }, id: \.self) { area in
                    ChoiceCard(title: area.localizedTitle, selected: model.profileDraftSecondary == area) {
                        model.send(.selectProfileSecondary(area))
                    }
                }
                PrimaryButton("Save areas") { model.send(.saveProfileAreas) }

                Text("Reminders").font(.title2.weight(.semibold))
                if profile.reminderAuthorization == .denied {
                    NoticeCard(
                        title: "Notifications are off",
                        message: "Your preferred window stays saved, and Kineo still works normally."
                    )
                    #if canImport(UIKit)
                    if let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                        SecondaryButton("Open iPhone Settings") { openURL(settingsURL) }
                    }
                    #endif
                } else if profile.reminderSettings?.enabled == true {
                    Label("One generic daily reminder is on", systemImage: "bell.fill")
                    SecondaryButton("Turn reminders off") { model.send(.disableReminder) }
                } else {
                    ForEach(ReminderWindowChoice.allCases, id: \.self) { choice in
                        SecondaryButton("Use a \(choice.title.lowercased()) reminder") {
                            model.send(.enableReminder(choice))
                        }
                    }
                }

                Text("Privacy and data").font(.title2.weight(.semibold))
                NoticeCard(
                    title: "Local by design",
                    message: "Your areas, check-ins, routines, and responses stay in Kineo on this iPhone. This prototype sends no Kineo analytics."
                )
                SecondaryButton("Reset history") { model.send(.requestResetHistory) }
                SecondaryButton("Delete all Kineo data") { model.send(.requestDeleteAll) }

                Text("Safety and support").font(.title2.weight(.semibold))
                NoticeCard(
                    title: "Movement planning, not treatment",
                    message: "Kineo does not diagnose or treat a condition. If an answer activates Attention Required, Kineo withholds new routines until you confirm that area has returned to its usual recurring pattern."
                )
                NoticeCard(
                    title: "Internal prototype",
                    message: "Use the in-app safety control whenever something feels wrong during a routine. Public-facing guidance and support details require professional review before release."
                )
            } else {
                ProgressView("Loading profile…")
            }
        }
    }
}

private struct ChangeCheckInView: View {
    let model: ProductFlowModel
    let draft: CheckInDraft
    var body: some View {
        let area = model.currentCheckInArea ?? draft.area
        FlowPage(title: "How does \(area.title.lowercased()) feel today?") {
            Text(area == draft.area ? "Primary area · Question 1 of 2" : "Secondary area · Question 1 of 2")
                .font(.headline).foregroundStyle(.secondary)
            ChoiceCard(title: "Better", symbol: "arrow.up") { model.send(.selectChange(.better)) }
            ChoiceCard(title: "Similar", symbol: "arrow.right") { model.send(.selectChange(.similar)) }
            ChoiceCard(title: "Worse", symbol: "arrow.down") { model.send(.selectChange(.worse)) }
            if model.canSkipSecondaryArea {
                SecondaryButton("Skip secondary for today") { model.send(.skipSecondaryArea) }
            }
        }
    }
}

private struct ComfortCheckInView: View {
    let model: ProductFlowModel
    let draft: CheckInDraft
    let change: ChangeReport
    var body: some View {
        let area = model.currentCheckInArea ?? draft.area
        FlowPage(title: "How comfortable does movement feel?") {
            Text("Question 2 of 2 for \(area.title)").font(.headline).foregroundStyle(.secondary)
            ChoiceCard(title: "Limited") { model.send(.selectComfort(.limited)) }
            ChoiceCard(title: "Okay") { model.send(.selectComfort(.okay)) }
            ChoiceCard(title: "Good") { model.send(.selectComfort(.good)) }
            if model.canSkipSecondaryArea {
                SecondaryButton("Skip secondary for today") { model.send(.skipSecondaryArea) }
            }
        }
    }
}

private struct ConditionalSafetyView: View {
    let model: ProductFlowModel
    let draft: CheckInDraft
    let change: ChangeReport
    let comfort: MovementComfort
    var body: some View {
        let area = model.currentCheckInArea ?? draft.area
        FlowPage(title: "One follow-up for \(area.title.lowercased())") {
            NoticeCard(
                title: "Is this new, sudden, or unusual for you?",
                message: "Choose the answer that best reflects today. Yes and Not sure both withhold a Kineo routine.",
                tone: .attention
            )
            ChoiceCard(title: "No") { model.send(.answerConditionalSafety(.no)) }
            ChoiceCard(title: "Yes") { model.send(.answerConditionalSafety(.yes)) }
            ChoiceCard(title: "Not sure") { model.send(.answerConditionalSafety(.notSure)) }
        }
    }
}

private struct AttentionGuidanceView: View {
    let model: ProductFlowModel
    let prompt: AttentionPrompt
    var body: some View {
        FlowPage(title: "Attention required") {
            NoticeCard(
                title: "No routine is available",
                message: "Kineo has withheld a routine because of your \(prompt.area.title.lowercased()) answer.",
                tone: .attention
            )
            PrimaryButton("Done") { model.send(.showAttentionReturn) }
            SecondaryButton("I selected that by mistake") {
                model.send(.startAttentionCorrection)
            }
        }
    }
}

private struct AttentionReturnView: View {
    let model: ProductFlowModel
    let prompt: AttentionPrompt
    var body: some View {
        FlowPage(title: "Before another check-in") {
            Text("Has your \(prompt.area.title.lowercased()) returned to what is usual for you?")
                .font(.headline)
            Text("This does not create a routine. If you answer Yes, you will still complete a fresh check-in.")
                .foregroundStyle(.secondary)
            ChoiceCard(title: "Yes") { model.send(.answerAttentionReturn(.yes)) }
            ChoiceCard(title: "No") { model.send(.answerAttentionReturn(.no)) }
            ChoiceCard(title: "Not sure") { model.send(.answerAttentionReturn(.notSure)) }
            SecondaryButton("I selected that by mistake") {
                model.send(.startAttentionCorrection)
            }
        }
    }
}

private struct AttentionCorrectionChangeView: View {
    let model: ProductFlowModel
    let draft: AttentionCorrectionDraft
    var body: some View {
        FlowPage(title: "Correct your \(draft.checkIn.area.title.lowercased()) answer") {
            Text("How does this area feel today?")
                .font(.headline)
            ChoiceCard(title: "Better") { model.send(.selectCorrectionChange(.better)) }
            ChoiceCard(title: "Similar") { model.send(.selectCorrectionChange(.similar)) }
            ChoiceCard(title: "Worse") { model.send(.selectCorrectionChange(.worse)) }
            SecondaryButton("Cancel correction") { model.send(.cancelAttentionCorrection) }
        }
    }
}

private struct AttentionCorrectionComfortView: View {
    let model: ProductFlowModel
    let draft: AttentionCorrectionDraft
    var body: some View {
        FlowPage(title: "Correct your movement answer") {
            Text("How comfortable does movement feel?")
                .font(.headline)
            ChoiceCard(title: "Limited") { model.send(.selectCorrectionComfort(.limited)) }
            ChoiceCard(title: "Okay") { model.send(.selectCorrectionComfort(.okay)) }
            ChoiceCard(title: "Good") { model.send(.selectCorrectionComfort(.good)) }
            SecondaryButton("Cancel correction") { model.send(.cancelAttentionCorrection) }
        }
    }
}

private struct AttentionCorrectionSafetyView: View {
    let model: ProductFlowModel
    let draft: AttentionCorrectionDraft
    var body: some View {
        FlowPage(title: "Correct your follow-up") {
            NoticeCard(
                title: "Is this new, sudden, or unusual for you?",
                message: "Yes and Not sure keep Attention Required active.",
                tone: .attention
            )
            ChoiceCard(title: "No") { model.send(.answerCorrectionSafety(.no)) }
            ChoiceCard(title: "Yes") { model.send(.answerCorrectionSafety(.yes)) }
            ChoiceCard(title: "Not sure") { model.send(.answerCorrectionSafety(.notSure)) }
            SecondaryButton("Cancel correction") { model.send(.cancelAttentionCorrection) }
        }
    }
}

private struct PlanView: View {
    let model: ProductFlowModel
    let plan: PlanPresentation
    var body: some View {
        FlowPage(title: "Your plan") {
            VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
                Label("\(plan.deliveredLevel.title) level", systemImage: plan.deliveredLevel.symbol).font(.title2.weight(.semibold))
                Text(plan.explanationText)
                Text("Included: \(plan.includedAreas.map(\.title).joined(separator: ", "))")
                    .foregroundStyle(.secondary)
                Text("\(plan.itemCount, format: .number) guided steps • \(plan.nominalMinutes, format: .number) minutes")
                    .foregroundStyle(.secondary)
            }
            .cardStyle()
            if let omitted = plan.omittedSecondaryArea {
                NoticeCard(
                    title: "Primary-area plan",
                    message: "\(omitted.title) is not included in this routine. Kineo did not substitute unapproved content."
                )
            }
            Text("Choose a complete routine length").font(.headline)
            VStack(spacing: KineoLayout.standardSpacing) {
                DurationButton(duration: .quick, selected: plan.duration == .quick) { model.send(.chooseDuration(.quick)) }
                DurationButton(duration: .standard, selected: plan.duration == .standard) { model.send(.chooseDuration(.standard)) }
            }
            if let gentler = plan.selectedLevel.gentlerLevel {
                SecondaryButton("Choose \(gentler.title) instead") { model.send(.chooseGentlerLevel(gentler)) }
            }
            PrimaryButton("Start routine") { model.send(.startRoutine) }
            if plan.pauseTodayAvailable {
                SecondaryButton("Pause for today") { model.send(.pauseToday) }
            }
            Text("Changing duration changes reviewed content, not the selected movement level.").font(.footnote).foregroundStyle(.secondary)
        }
    }
}

private struct PauseTodayConfirmationView: View {
    let model: ProductFlowModel
    let area: BodyArea
    var body: some View {
        FlowPage(title: "Paused for today") {
            Image(systemName: "pause.circle")
                .font(.largeTitle)
                .accessibilityHidden(true)
            Text("No \(area.title.lowercased()) routine was started. You can check in again when you choose.")
            PrimaryButton("Done") { model.send(.finishPauseToday) }
        }
    }
}

private struct RoutineView: View {
    @AccessibilityFocusState private var pausedFocused: Bool
    let model: ProductFlowModel
    let routine: RoutinePresentation
    var body: some View {
        FlowPage(title: "Guided routine") {
            if routine.contentAvailable {
                Text("Step \(routine.currentStepIndex + KineoLayout.humanIndexOffset, format: .number) of \(routine.totalStepCount, format: .number)")
                    .font(.headline).foregroundStyle(.secondary)
                if routine.currentItem != nil {
                    VStack(alignment: .leading, spacing: KineoLayout.standardSpacing) {
                        Text(routine.presentedTitle).font(.title2.weight(.semibold))
                        if let instruction = routine.presentedInstruction { Text(instruction) }
                        if let safetyCue = routine.presentedSafetyCue {
                            Label(safetyCue, systemImage: "info.circle").font(.callout)
                        }
                        if let dose = routine.presentedDose {
                            Text(dose.presentationText).font(.headline)
                            Text(routine.timerText(for: dose))
                                .font(.title3.monospacedDigit().weight(.semibold))
                                .accessibilityLabel("Routine timer")
                                .accessibilityValue(routine.timerText(for: dose))
                        }
                        if routine.selectedAlternative != nil {
                            Label("Approved alternative selected", systemImage: "arrow.triangle.branch")
                                .font(.callout)
                        }
                    }
                    .cardStyle()
                }
                NoticeCard(title: "Prototype content", message: "Use only as an internal functional demonstration. Production movement guidance still requires professional review.")
                if routine.status == .paused {
                    Label("Paused", systemImage: "pause.circle.fill")
                        .font(.headline)
                        .accessibilityHeading(.h2)
                        .accessibilityFocused($pausedFocused)
                    PrimaryButton("Resume") { model.send(.resumeRoutine) }
                } else {
                    if routine.isLastStep {
                        PrimaryButton("Complete routine") { model.send(.advanceRoutine) }
                    } else {
                        PrimaryButton("Complete step") { model.send(.advanceRoutine) }
                    }
                    SecondaryButton("Pause") { model.send(.pauseRoutine) }
                    SecondaryButton("Skip this step") { model.send(.skipRoutineStep(nil)) }
                }
                if routine.currentItem?.availableAlternatives.isEmpty == false {
                    SecondaryButton("Choose an alternative") { model.send(.requestAlternative) }
                }
                SecondaryButton("End routine") { model.send(.requestEndRoutine) }
                SecondaryButton("Something feels wrong") { model.send(.somethingFeelsWrong) }
            } else {
                NoticeCard(
                    title: "Content unavailable",
                    message: "A required installed asset could not be verified. Kineo will not play a partial routine."
                )
                PrimaryButton("End incomplete routine") { model.send(.requestEndRoutine) }
            }
        }
        .task(id: routine.status) {
            if routine.status == .paused { pausedFocused = true }
        }
    }
}

private struct AlternativePreviewView: View {
    let model: ProductFlowModel
    let routine: RoutinePresentation
    var body: some View {
        FlowPage(title: "Choose an alternative") {
            Text("The routine is paused. Only alternatives frozen into this routine are shown.")
                .foregroundStyle(.secondary)
            ForEach(routine.currentItem?.availableAlternatives ?? [], id: \.movementID) { alternative in
                Button {
                    model.send(.chooseAlternative(alternative.movementID))
                } label: {
                    VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
                        Text(alternative.localizedTitle.rawValue).font(.headline)
                        Text(alternative.localizedInstruction.rawValue)
                    }
                    .cardStyle()
                }
                .buttonStyle(.plain)
            }
            SecondaryButton("Cancel") { model.send(.cancelRoutineModal) }
        }
    }
}

private struct EndRoutineConfirmationView: View {
    let model: ProductFlowModel
    let routine: RoutinePresentation
    var body: some View {
        FlowPage(title: "End this routine?") {
            Text("The routine is paused. Ending now saves it as incomplete, not completed.")
            PrimaryButton("End routine") { model.send(.confirmEndRoutine) }
            SecondaryButton("Keep it paused") { model.send(.cancelRoutineModal) }
        }
    }
}

private struct RoutineSafetyGuidanceView: View {
    let model: ProductFlowModel
    let routine: RoutinePresentation
    var body: some View {
        FlowPage(title: "Stop and check how you feel") {
            NoticeCard(
                title: "The routine is paused",
                message: "Kineo will not resume automatically. End the routine if you do not want to continue.",
                tone: .attention
            )
            PrimaryButton("End routine") { model.send(.confirmSafetyEnd) }
            SecondaryButton("I tapped this by mistake") { model.send(.safetyTappedByMistake) }
        }
    }
}

private struct FeedbackView: View {
    let model: ProductFlowModel
    let routine: RoutinePresentation
    var body: some View {
        FlowPage(title: "How do you feel now?") {
            Text("Feedback is optional and does not change the routine you just completed.")
            ForEach(routine.includedAreas, id: \.self) { area in
                VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
                    Text(area.title).font(.headline)
                    ChoiceCard(
                        title: "Better",
                        symbol: "arrow.up",
                        selected: model.feedbackResponse(for: area) == .better
                    ) { model.send(.selectFeedback(area, .better)) }
                    ChoiceCard(
                        title: "Same",
                        symbol: "arrow.right",
                        selected: model.feedbackResponse(for: area) == .same
                    ) { model.send(.selectFeedback(area, .same)) }
                    ChoiceCard(
                        title: "Worse",
                        symbol: "arrow.down",
                        selected: model.feedbackResponse(for: area) == .worse
                    ) { model.send(.selectFeedback(area, .worse)) }
                }
            }
            PrimaryButton("Save feedback") { model.send(.submitAreaFeedback) }
                .disabled(routine.includedAreas.allSatisfy { model.feedbackResponse(for: $0) == nil })
            if routine.includedAreas.allSatisfy({ model.feedbackResponse(for: $0) == nil }) {
                Text("Choose at least one response to save, or skip all feedback.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            SecondaryButton("Skip all feedback") { model.send(.skipFeedback) }
        }
    }
}

private struct CompletionView: View {
    let model: ProductFlowModel
    let area: BodyArea
    var body: some View {
        FlowPage(title: "Routine complete") {
            Image(systemName: "checkmark.circle")
                .font(.largeTitle)
                .accessibilityHidden(true)
            Text("Your \(area.title.lowercased()) routine and optional response are saved locally.")
            PrimaryButton("Done") { model.send(.finishCompletion) }
        }
    }
}

private struct ResetHistoryConfirmationView: View {
    let model: ProductFlowModel
    let area: BodyArea

    var body: some View {
        FlowPage(title: "Reset history?") {
            Text("This removes check-ins, plans, routines, feedback, and Progress history.")
            NoticeCard(
                title: "Safety exception",
                message: "Any current Attention Required area remains so Reset cannot bypass it. Your areas and reminder preference also remain."
            )
            DestructiveButton("Reset history") { model.send(.confirmResetHistory) }
            SecondaryButton("Cancel") { model.send(.cancelDataControl) }
            Text("Current primary area: \(area.title)").font(.footnote).foregroundStyle(.secondary)
        }
    }
}

private struct DeleteAllConfirmationView: View {
    let model: ProductFlowModel

    var body: some View {
        FlowPage(title: "Delete all Kineo data?") {
            Text("This removes your profile, all local history, current Attention rows, and Kineo reminders. It cannot be undone.")
            Text("It does not change iPhone notification permission history or data and diagnostics held independently by Apple.")
            DestructiveButton("Delete all data") { model.send(.confirmDeleteAll) }
            SecondaryButton("Cancel") { model.send(.cancelDataControl) }
            Text("You will return to onboarding.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}

private struct FlowPage<Content: View>: View {
    @AccessibilityFocusState private var titleFocused: Bool
    let title: LocalizedStringKey
    @ViewBuilder let content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KineoLayout.sectionSpacing) {
                Text(title)
                    .font(.largeTitle.bold())
                    .accessibilityHeading(.h1)
                    .accessibilityFocused($titleFocused)
                content
            }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(KineoLayout.screenMargin)
        }
        .navigationTitle("Kineo")
        .kineoInlineNavigationTitle()
        .task { titleFocused = true }
    }
}

private struct ChoiceCard: View {
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor
    let title: LocalizedStringKey
    var symbol: String?
    var selected = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: KineoLayout.standardSpacing) {
                if let symbol {
                    Image(systemName: symbol).accessibilityHidden(true)
                }
                Text(title)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if selected {
                    Image(systemName: "checkmark.circle.fill").accessibilityHidden(true)
                }
            }
            .padding(KineoLayout.standardSpacing)
            .frame(minHeight: KineoLayout.minimumPrimaryControlHeight)
            .background(selected ? Color.accentColor.opacity(KineoLayout.selectedSurfaceOpacity) : Color.secondary.opacity(KineoLayout.unselectedSurfaceOpacity))
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius))
            .overlay {
                RoundedRectangle(cornerRadius: KineoLayout.controlRadius)
                    .stroke(
                        selected ? Color.accentColor : Color.secondary.opacity(KineoLayout.borderOpacity),
                        lineWidth: contrast == .increased ? KineoLayout.increasedBorderWidth : KineoLayout.standardBorderWidth
                    )
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(selectionValue))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityHint(
            differentiateWithoutColor && selected ?
                "A checkmark also shows this choice is selected." : ""
        )
    }

    private var selectionValue: LocalizedStringKey {
        selected ? "Selected" : "Not selected"
    }
}

private struct NoticeCard: View {
    enum Tone: Equatable { case information, attention }

    let title: LocalizedStringKey
    let message: LocalizedStringKey
    var tone: Tone = .information
    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
            Label(title, systemImage: tone == .attention ? "exclamationmark.circle" : "info.circle")
                .font(.headline)
            Text(message).fixedSize(horizontal: false, vertical: true)
        }
        .padding(KineoLayout.standardSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone == .attention ? Color.orange.opacity(KineoLayout.attentionSurfaceOpacity) : Color.secondary.opacity(KineoLayout.unselectedSurfaceOpacity))
        .clipShape(RoundedRectangle(cornerRadius: KineoLayout.cardRadius))
        .accessibilityElement(children: .combine)
    }
}

private struct PrimaryButton: View {
    let title: LocalizedStringKey
    let action: () -> Void
    init(_ title: LocalizedStringKey, action: @escaping () -> Void) { self.title = title; self.action = action }
    var body: some View {
        Button(action: action) {
            Text(title).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
        }
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight)
            .buttonStyle(.borderedProminent).controlSize(.large)
    }
}

private struct SecondaryButton: View {
    let title: LocalizedStringKey
    let action: () -> Void
    init(_ title: LocalizedStringKey, action: @escaping () -> Void) { self.title = title; self.action = action }
    var body: some View {
        Button(action: action) {
            Text(title).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
        }
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumTouchTarget)
            .buttonStyle(.bordered).controlSize(.large)
    }
}

private struct DestructiveButton: View {
    let title: LocalizedStringKey
    let action: () -> Void

    init(_ title: LocalizedStringKey, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(role: .destructive, action: action) {
            Text(title).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumTouchTarget)
        .buttonStyle(.bordered)
        .controlSize(.large)
    }
}

private struct DurationButton: View {
    let duration: DurationVariant
    let selected: Bool
    let action: () -> Void
    var body: some View {
        ChoiceCard(title: duration.localizedTitle, selected: selected, action: action)
    }
}

private struct ErrorNotice: View {
    @AccessibilityFocusState private var errorFocused: Bool
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
            Text("Something needs your attention").font(.headline).accessibilityHeading(.h2)
            Text(message)
            Button("Retry", action: retry).frame(minHeight: KineoLayout.minimumTouchTarget)
        }
            .padding(KineoLayout.standardSpacing).frame(maxWidth: .infinity, alignment: .leading).background(.regularMaterial)
            .accessibilityElement(children: .contain)
            .accessibilityFocused($errorFocused)
            .task { errorFocused = true }
    }
}

private extension View {
    @ViewBuilder
    func kineoInlineNavigationTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    func cardStyle() -> some View {
        padding(KineoLayout.standardSpacing).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(KineoLayout.unselectedSurfaceOpacity))
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.cardRadius))
    }
}

private extension BodyArea {
    var title: String { switch self { case .neck: "Neck"; case .upperMidBack: "Upper or mid-back"; case .lowerBack: "Lower back" } }
    var localizedTitle: LocalizedStringKey {
        switch self {
        case .neck: "Neck"
        case .upperMidBack: "Upper or mid-back"
        case .lowerBack: "Lower back"
        }
    }
}

private extension RoutineLevel {
    var title: String { rawValue.capitalized }
    var symbol: String { switch self { case .gentle: "circle"; case .balanced: "circle.lefthalf.filled"; case .active: "circle.fill" } }
    var gentlerLevel: RoutineLevel? { switch self { case .active: .balanced; case .balanced: .gentle; case .gentle: nil } }
}

private extension DurationVariant {
    var title: String { switch self { case .quick: "Quick"; case .standard: "Standard" } }
    var localizedTitle: LocalizedStringKey {
        switch self {
        case .quick: "Quick"
        case .standard: "Standard"
        }
    }
}

private extension AreaResponse {
    var title: String {
        switch self {
        case .better: "Better"
        case .same: "Same"
        case .worse: "Worse"
        }
    }
}

private extension PlanPresentation {
    var nominalMinutes: Int { nominalSeconds / KineoLayout.secondsPerMinute }
    var explanationText: String {
        guard let key = explanationKeys.first else { return "Based on today's check-in." }
        return switch key {
        case .userGentlerOverride: "You chose a gentler available plan."
        case .reportedWorse: "Your current report keeps today's plan gentle."
        case .movementLimited: "Your movement-comfort answer keeps today's plan gentle."
        case .betterGoodActive: "Your current answer and your own Kineo history allow Active."
        case .balancedCheckIn: "Today's answers map to a Balanced plan."
        case .activeLocked: "Balanced remains available while Kineo builds your area-specific history."
        case .secondaryMoreConservative: "The more conservative included-area result sets the plan."
        }
    }
}

private extension Dose {
    var presentationText: String {
        switch kind {
        case .timed: "About \(estimatedSeconds.formatted()) seconds"
        case .repetitions:
            if let repetitionCount {
                "\(repetitionCount.formatted()) repetitions"
            } else {
                "Repetitions"
            }
        }
    }
}

private extension RoutinePresentation {
    var isLastStep: Bool { currentStepIndex == totalStepCount - KineoLayout.humanIndexOffset }

    var presentedTitle: String {
        selectedAlternative?.localizedTitle.rawValue ?? currentItem?.localizedTitle.rawValue ?? "Routine step"
    }

    var presentedInstruction: String? {
        selectedAlternative?.localizedInstruction.rawValue ?? currentItem?.localizedInstruction?.rawValue
    }

    var presentedSafetyCue: String? {
        selectedAlternative?.localizedSafetyCue.rawValue ?? currentItem?.localizedSafetyCue?.rawValue
    }

    var presentedDose: Dose? {
        selectedAlternative?.scheduledDose ?? currentItem?.scheduledDose
    }

    func timerText(for dose: Dose) -> String {
        let elapsedSeconds = stepElapsedMilliseconds / KineoLayout.millisecondsPerSecond
        switch dose.kind {
        case .timed:
            let totalMilliseconds = Int64(dose.estimatedSeconds) * KineoLayout.millisecondsPerSecond
            let remainingMilliseconds = max(KineoLayout.noElapsedMilliseconds, totalMilliseconds - stepElapsedMilliseconds)
            let remainingSeconds = (
                remainingMilliseconds + KineoLayout.countdownRoundingOffset
            ) / KineoLayout.millisecondsPerSecond
            return status == .paused ?
                "Paused with \(remainingSeconds.formatted()) seconds remaining" :
                "\(remainingSeconds.formatted()) seconds remaining"
        case .repetitions:
            return status == .paused ?
                "Paused after \(elapsedSeconds.formatted()) seconds" :
                "\(elapsedSeconds.formatted()) seconds elapsed"
        }
    }
}

private enum KineoLayout {
    static let compactSpacing: CGFloat = 8
    static let standardSpacing: CGFloat = 16
    static let sectionSpacing: CGFloat = 24
    static let screenMargin: CGFloat = 20
    static let minimumTouchTarget: CGFloat = 44
    static let minimumPrimaryControlHeight: CGFloat = 52
    static let controlRadius: CGFloat = 16
    static let cardRadius: CGFloat = 24
    static let selectedSurfaceOpacity = 0.14
    static let unselectedSurfaceOpacity = 0.08
    static let borderOpacity = 0.35
    static let attentionSurfaceOpacity = 0.16
    static let standardBorderWidth: CGFloat = 1
    static let increasedBorderWidth: CGFloat = 2
    static let secondsPerMinute = 60
    static let millisecondsPerSecond: Int64 = 1_000
    static let countdownRoundingOffset = millisecondsPerSecond - 1
    static let noElapsedMilliseconds: Int64 = 0
    static let humanIndexOffset = 1
}

private enum KineoProductCopy {
    static let minimumSupportedAge = 18
}

#Preview { KineoRootView(launchState: .foundationReady) }
