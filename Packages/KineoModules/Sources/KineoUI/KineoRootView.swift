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
                case .safetyBoundary(let area): SafetyBoundaryView(model: model, area: area)
                case .firstCheckIn(let area): FirstCheckInView(model: model, area: area)
                case .today(let area): TodayTabsView(model: model, area: area)
                case .checkInChange(let draft): ChangeCheckInView(model: model, draft: draft)
                case .checkInComfort(let draft, let change):
                    ComfortCheckInView(model: model, draft: draft, change: change)
                case .conditionalSafety(let draft, let change, let comfort):
                    ConditionalSafetyView(model: model, draft: draft, change: change, comfort: comfort)
                case .attentionRequired(let area): AttentionRequiredView(area: area)
                case .plan(let plan): PlanView(model: model, plan: plan)
                case .routine(let routine): RoutineView(model: model, routine: routine)
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
        .task(id: scenePhase) {
            guard scenePhase == .active,
                  case .launching(let launchState) = model.state,
                  launchState != .foundationReady else { return }
            model.send(.load)
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
        FlowPage(title: "How does \(draft.area.title.lowercased()) feel today?") {
            Text("Question 1 of 2").font(.headline).foregroundStyle(.secondary)
            ChoiceCard(title: "Better", symbol: "arrow.up") { model.send(.selectChange(.better)) }
            ChoiceCard(title: "Similar", symbol: "arrow.right") { model.send(.selectChange(.similar)) }
            ChoiceCard(title: "Worse", symbol: "arrow.down") { model.send(.selectChange(.worse)) }
        }
    }
}

private struct ComfortCheckInView: View {
    let model: ProductFlowModel
    let draft: SingleAreaCheckInDraft
    let change: ChangeReport
    var body: some View {
        FlowPage(title: "How comfortable does movement feel?") {
            Text("Question 2 of 2 for \(draft.area.title)").font(.headline).foregroundStyle(.secondary)
            ChoiceCard(title: "Limited") { model.send(.selectComfort(.limited)) }
            ChoiceCard(title: "Okay") { model.send(.selectComfort(.okay)) }
            ChoiceCard(title: "Good") { model.send(.selectComfort(.good)) }
        }
    }
}

private struct ConditionalSafetyView: View {
    let model: ProductFlowModel
    let draft: SingleAreaCheckInDraft
    let change: ChangeReport
    let comfort: MovementComfort
    var body: some View {
        FlowPage(title: "One follow-up for \(draft.area.title.lowercased())") {
            NoticeCard(title: "Is this new, sudden, or unusual for you?", message: "Choose the answer that best reflects today. Yes and Not sure both withhold a Kineo routine.")
            ChoiceCard(title: "No") { model.send(.answerConditionalSafety(.no)) }
            ChoiceCard(title: "Yes") { model.send(.answerConditionalSafety(.yes)) }
            ChoiceCard(title: "Not sure") { model.send(.answerConditionalSafety(.notSure)) }
        }
    }
}

private struct AttentionRequiredView: View {
    let area: BodyArea
    var body: some View {
        ContentUnavailableView {
            Label("Attention required", systemImage: "exclamationmark.circle")
        } description: {
            Text("Kineo has withheld a routine because of your \(area.title.lowercased()) answer.")
        }
        .navigationTitle("Attention required")
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
                Text("\(plan.itemCount) guided steps • \(plan.nominalMinutes) minutes").foregroundStyle(.secondary)
            }
            .cardStyle()
            Text("Choose a complete routine length").font(.headline)
            VStack(spacing: KineoLayout.standardSpacing) {
                DurationButton(duration: .quick, selected: plan.duration == .quick) { model.send(.chooseDuration(.quick)) }
                DurationButton(duration: .standard, selected: plan.duration == .standard) { model.send(.chooseDuration(.standard)) }
            }
            if let gentler = plan.selectedLevel.gentlerLevel {
                SecondaryButton("Choose \(gentler.title) instead") { model.send(.chooseGentlerLevel(gentler)) }
            }
            PrimaryButton("Start routine") { model.send(.startRoutine) }
            Text("Changing duration changes reviewed content, not the selected movement level.").font(.footnote).foregroundStyle(.secondary)
        }
    }
}

private struct RoutineView: View {
    let model: ProductFlowModel
    let routine: RoutinePresentation
    var body: some View {
        FlowPage(title: "Guided routine") {
            Text("Step \(routine.currentStepIndex + KineoLayout.humanIndexOffset) of \(routine.totalStepCount)").font(.headline).foregroundStyle(.secondary)
            if let item = routine.currentItem {
                VStack(alignment: .leading, spacing: KineoLayout.standardSpacing) {
                    Text(item.localizedTitle.rawValue).font(.title2.weight(.semibold))
                    if let instruction = item.localizedInstruction { Text(instruction.rawValue) }
                    if let safetyCue = item.localizedSafetyCue { Label(safetyCue.rawValue, systemImage: "info.circle").font(.callout) }
                    if let dose = item.scheduledDose { Text(dose.presentationText).font(.headline) }
                }
                .cardStyle()
            }
            NoticeCard(title: "Prototype content", message: "Use only as an internal functional demonstration. Production movement guidance still requires professional review.")
            PrimaryButton(routine.isLastStep ? "Complete routine" : "Complete step") { model.send(.advanceRoutine) }
        }
    }
}

private struct FeedbackView: View {
    let model: ProductFlowModel
    let routine: RoutinePresentation
    var body: some View {
        FlowPage(title: "How does \(routine.area.title.lowercased()) feel now?") {
            Text("Feedback is optional and does not change the routine you just completed.")
            ChoiceCard(title: "Better", symbol: "arrow.up") { model.send(.submitFeedback(.better)) }
            ChoiceCard(title: "Same", symbol: "arrow.right") { model.send(.submitFeedback(.same)) }
            ChoiceCard(title: "Worse", symbol: "arrow.down") { model.send(.submitFeedback(.worse)) }
            SecondaryButton("Skip feedback") { model.send(.submitFeedback(nil)) }
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
    static let humanIndexOffset = 1
}

private enum KineoProductCopy {
    static let minimumSupportedAge = 18
}

#Preview { KineoRootView(launchState: .foundationReady) }
