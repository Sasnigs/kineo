import KineoCore
import SwiftUI

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
        ContentUnavailableView {
            Label("Kineo", systemImage: "figure.walk")
        } description: {
            Text(message)
        }
        .navigationTitle("Kineo")
    }

    private var message: String {
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
        ContentUnavailableView {
            Label("Kineo is adults only", systemImage: "person.crop.circle.badge.xmark")
        } description: {
            Text("This prototype is not available for people under \(KineoProductCopy.minimumSupportedAge).")
        } actions: {
            Button("Correct my answer") { model.send(.correctAge) }
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
                ChoiceCard(title: area.title, selected: selected == area) { model.send(.selectPrimaryArea(area)) }
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
                ChoiceCard(title: area.title, selected: selected == area) {
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
            NoticeCard(title: "Pay attention to changes", message: "If something feels new, sudden, unusual, or movement feels limited, answer the follow-up honestly. Kineo may withhold a routine.")
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
            PlaceholderTab(title: "Progress", message: "Your local history and patterns arrive in a later milestone.", symbol: "chart.line.uptrend.xyaxis")
                .tabItem { Label("Progress", systemImage: "chart.line.uptrend.xyaxis") }
            PlaceholderTab(title: "Profile", message: "Area settings, reminders, privacy, and data controls arrive in a later milestone.", symbol: "person.crop.circle")
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
    }
}

private struct ChangeCheckInView: View {
    let model: ProductFlowModel
    let draft: SingleAreaCheckInDraft
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
    let draft: SingleAreaCheckInDraft
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
    let draft: SingleAreaCheckInDraft
    let change: ChangeReport
    let comfort: MovementComfort
    var body: some View {
        let area = model.currentCheckInArea ?? draft.area
        FlowPage(title: "One follow-up for \(area.title.lowercased())") {
            NoticeCard(title: "Is this new, sudden, or unusual for you?", message: "Choose the answer that best reflects today. Yes and Not sure both withhold a Kineo routine.")
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
        ContentUnavailableView {
            Label("Attention required", systemImage: "exclamationmark.circle")
        } description: {
            Text("Kineo has withheld a routine because of your \(prompt.area.title.lowercased()) answer.")
        } actions: {
            VStack(spacing: KineoLayout.standardSpacing) {
                Button("Done") { model.send(.showAttentionReturn) }
                Button("I selected that by mistake") { model.send(.startAttentionCorrection) }
            }
        }
        .navigationTitle("Attention required")
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
                message: "Yes and Not sure keep Attention Required active."
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
                Text("\(plan.itemCount) guided steps • \(plan.nominalMinutes) minutes").foregroundStyle(.secondary)
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
        ContentUnavailableView {
            Label("Paused for today", systemImage: "pause.circle")
        } description: {
            Text("No \(area.title.lowercased()) routine was started. You can check in again when you choose.")
        } actions: {
            Button("Done") { model.send(.finishPauseToday) }
        }
    }
}

private struct RoutineView: View {
    let model: ProductFlowModel
    let routine: RoutinePresentation
    var body: some View {
        FlowPage(title: "Guided routine") {
            if routine.contentAvailable {
                Text("Step \(routine.currentStepIndex + KineoLayout.humanIndexOffset) of \(routine.totalStepCount)").font(.headline).foregroundStyle(.secondary)
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
                    PrimaryButton("Resume") { model.send(.resumeRoutine) }
                } else {
                    PrimaryButton(routine.isLastStep ? "Complete routine" : "Complete step") {
                        model.send(.advanceRoutine)
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
                message: "Kineo will not resume automatically. End the routine if you do not want to continue."
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
            SecondaryButton("Skip all feedback") { model.send(.skipFeedback) }
        }
    }
}

private struct CompletionView: View {
    let model: ProductFlowModel
    let area: BodyArea
    var body: some View {
        ContentUnavailableView {
            Label("Routine complete", systemImage: "checkmark.circle")
        } description: {
            Text("Your \(area.title.lowercased()) routine and optional response are saved locally.")
        } actions: {
            Button("Done") { model.send(.finishCompletion) }
        }
    }
}

private struct FlowPage<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KineoLayout.sectionSpacing) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(KineoLayout.screenMargin)
        }
        .navigationTitle(title)
    }
}

private struct ChoiceCard: View {
    let title: String
    var symbol: String?
    var selected = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: KineoLayout.standardSpacing) {
                if let symbol { Image(systemName: symbol) }
                Text(title).frame(maxWidth: .infinity, alignment: .leading)
                if selected { Image(systemName: "checkmark.circle.fill") }
            }
            .padding(KineoLayout.standardSpacing)
            .frame(minHeight: KineoLayout.minimumPrimaryControlHeight)
            .background(selected ? Color.accentColor.opacity(KineoLayout.selectedSurfaceOpacity) : Color.secondary.opacity(KineoLayout.unselectedSurfaceOpacity))
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius))
            .overlay { RoundedRectangle(cornerRadius: KineoLayout.controlRadius).stroke(selected ? Color.accentColor : Color.secondary.opacity(KineoLayout.borderOpacity)) }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct NoticeCard: View {
    let title: String
    let message: String
    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) { Text(title).font(.headline); Text(message) }
            .cardStyle()
    }
}

private struct PrimaryButton: View {
    let title: String
    let action: () -> Void
    init(_ title: String, action: @escaping () -> Void) { self.title = title; self.action = action }
    var body: some View {
        Button(title, action: action).font(.headline)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight)
            .buttonStyle(.borderedProminent).controlSize(.large)
    }
}

private struct SecondaryButton: View {
    let title: String
    let action: () -> Void
    init(_ title: String, action: @escaping () -> Void) { self.title = title; self.action = action }
    var body: some View {
        Button(title, action: action)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumTouchTarget)
            .buttonStyle(.bordered).controlSize(.large)
    }
}

private struct DurationButton: View {
    let duration: DurationVariant
    let selected: Bool
    let action: () -> Void
    var body: some View { ChoiceCard(title: duration.title, selected: selected, action: action) }
}

private struct PlaceholderTab: View {
    let title: String
    let message: String
    let symbol: String
    var body: some View { ContentUnavailableView(title, systemImage: symbol, description: Text(message)) }
}

private struct ErrorNotice: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) { Text(message); Button("Retry", action: retry) }
            .padding(KineoLayout.standardSpacing).frame(maxWidth: .infinity, alignment: .leading).background(.regularMaterial)
    }
}

private extension View {
    func cardStyle() -> some View {
        padding(KineoLayout.standardSpacing).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(KineoLayout.unselectedSurfaceOpacity))
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.cardRadius))
    }
}

private extension BodyArea {
    var title: String { switch self { case .neck: "Neck"; case .upperMidBack: "Upper or mid-back"; case .lowerBack: "Lower back" } }
}

private extension RoutineLevel {
    var title: String { rawValue.capitalized }
    var symbol: String { switch self { case .gentle: "circle"; case .balanced: "circle.lefthalf.filled"; case .active: "circle.fill" } }
    var gentlerLevel: RoutineLevel? { switch self { case .active: .balanced; case .balanced: .gentle; case .gentle: nil } }
}

private extension DurationVariant {
    var title: String { switch self { case .quick: "Quick"; case .standard: "Standard" } }
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
        case .timed: "About \(estimatedSeconds) seconds"
        case .repetitions:
            if let repetitionCount {
                "\(repetitionCount) repetitions"
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
                "Paused with \(remainingSeconds) seconds remaining" :
                "\(remainingSeconds) seconds remaining"
        case .repetitions:
            return status == .paused ?
                "Paused after \(elapsedSeconds) seconds" :
                "\(elapsedSeconds) seconds elapsed"
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
