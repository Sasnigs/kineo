import KineoCore
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public struct KineoRootView: View {
    @State private var model: ProductFlowModel?
    private let fixedLaunchState: AppLaunchState?
    private let showsPrototypeResetControl: Bool

    public init(launchState: AppLaunchState) {
        fixedLaunchState = launchState
        showsPrototypeResetControl = false
        _model = State(initialValue: nil)
    }

    public init(
        productService: any KineoProductServing,
        showsPrototypeResetControl: Bool = false
    ) {
        fixedLaunchState = nil
        self.showsPrototypeResetControl = showsPrototypeResetControl
        _model = State(initialValue: ProductFlowModel(service: productService))
    }

    public var body: some View {
        if let model {
            ProductFlowContainer(
                model: model,
                showsPrototypeResetControl: showsPrototypeResetControl
            )
        } else {
            LaunchStateView(state: fixedLaunchState ?? .preparingFoundation)
        }
    }
}

private struct ProductFlowContainer: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State var model: ProductFlowModel
    let showsPrototypeResetControl: Bool

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
                case .today(let area):
                    TodayTabsView(
                        model: model,
                        area: area,
                        showsPrototypeResetControl: showsPrototypeResetControl
                    )
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
        .tint(KineoColor.accent)
    }
}

private struct LaunchStateView: View {
    let state: AppLaunchState

    var body: some View {
        FlowPage(title: "Kineo", eyebrow: "Daily movement", symbol: "figure.flexibility") {
            NoticeCard(title: statusTitle, message: message)
        }
    }

    private var statusTitle: LocalizedStringKey {
        switch state {
        case .preparingFoundation: "Getting ready"
        case .foundationReady: "Ready"
        case .protectedDataUnavailable: "iPhone locked"
        case .foundationUnavailable: "Storage unavailable"
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
    @AccessibilityFocusState private var titleFocused: Bool
    let model: ProductFlowModel

    var body: some View {
        ZStack {
            KineoBackdrop()
            ScrollView {
                VStack(alignment: .leading, spacing: KineoLayout.sectionSpacing) {
                    KineoWordmark()
                    VStack(alignment: .leading, spacing: KineoLayout.smallSpacing) {
                        Text("Movement for how today feels")
                            .font(.largeTitle.bold())
                            .foregroundStyle(KineoColor.brandInk)
                            .accessibilityHeading(.h1)
                            .accessibilityFocused($titleFocused)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Two quick answers. One clear next step.")
                            .font(.title3.weight(.medium))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    KineoHeroArtwork()
                    PrimaryButton("Get started", symbol: "arrow.right") {
                        model.send(.getStarted)
                    }
                    NoticeCard(
                        title: "Internal prototype",
                        message: "For adults with usual recurring neck or back discomfort. Kineo does not diagnose or treat a condition."
                    )
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, KineoLayout.screenMargin)
                .padding(.top, KineoLayout.standardSpacing)
                .padding(.bottom, KineoLayout.spaciousSectionSpacing)
            }
        }
        .kineoNavigationChrome()
        .task { titleFocused = true }
    }
}

private struct AgeConfirmationView: View {
    let model: ProductFlowModel
    var body: some View {
        FlowPage(title: "Are you \(KineoProductCopy.minimumSupportedAge) or older?", symbol: "person.crop.circle.badge.checkmark") {
            KineoFlowProgressView(progress: .onboarding(stage: .eligibility))
            Text("Kineo is currently designed for adults. We do not ask for your birth date.")
                .foregroundStyle(.secondary)
            PrimaryButton("Yes, I am \(KineoProductCopy.minimumSupportedAge) or older", symbol: "checkmark") {
                model.send(.confirmAdult)
            }
            SecondaryButton("No") { model.send(.underAge) }
        }
    }
}

private struct AgeUnavailableView: View {
    let model: ProductFlowModel
    var body: some View {
        FlowPage(title: "Kineo is adults only", eyebrow: "Eligibility", symbol: "person.crop.circle.badge.xmark") {
            Text("This prototype is not available for people under \(KineoProductCopy.minimumSupportedAge).")
            PrimaryButton("Correct my answer") { model.send(.correctAge) }
        }
    }
}

private struct PrimaryAreaView: View {
    let model: ProductFlowModel
    let selected: BodyArea?
    var body: some View {
        FlowPage(title: "Choose your main area", symbol: "scope") {
            KineoFlowProgressView(progress: .onboarding(stage: .primaryArea))
            Text("Start with the area you most want help planning movement for.")
                .foregroundStyle(.secondary)
            ForEach(BodyArea.allCases, id: \.self) { area in
                ChoiceCard(
                    title: area.localizedTitle,
                    subtitle: area.selectionSubtitle,
                    symbol: area.symbol,
                    selected: selected == area
                ) { model.send(.selectPrimaryArea(area)) }
            }
            PrimaryButton("Continue", symbol: "arrow.right") { model.send(.continuePrimaryArea) }
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
        FlowPage(title: "Add another area?", symbol: "plus.circle") {
            KineoFlowProgressView(progress: .onboarding(stage: .secondaryArea))
            Text("Optional. Your \(primary.title.lowercased()) stays the main focus.")
                .foregroundStyle(.secondary)
            ChoiceCard(title: "No secondary area", subtitle: "Keep today's routine focused", symbol: "minus", selected: selected == nil) {
                model.send(.selectSecondaryArea(nil))
            }
            ForEach(BodyArea.allCases.filter { $0 != primary }, id: \.self) { area in
                ChoiceCard(title: area.localizedTitle, subtitle: "Add a short reviewed module", symbol: area.symbol, selected: selected == area) {
                    model.send(.selectSecondaryArea(area))
                }
            }
            PrimaryButton("Continue", symbol: "arrow.right") { model.send(.continueSecondaryArea) }
        }
    }
}

private struct SafetyBoundaryView: View {
    let model: ProductFlowModel
    let area: BodyArea
    var body: some View {
        FlowPage(title: "Before your first check-in", symbol: "shield.lefthalf.filled") {
            KineoFlowProgressView(progress: .onboarding(stage: .safety))
            Text("Kineo supports self-directed movement planning for your usual recurring \(area.title.lowercased()) discomfort.")
            NoticeCard(
                title: "Pay attention to changes",
                message: "If something feels new, sudden, unusual, or movement feels limited, answer the follow-up honestly. Kineo may withhold a routine.",
                tone: .attention
            )
            Text("Prototype wording requires professional review before use outside the product team.")
                .font(.footnote).foregroundStyle(.secondary)
            PrimaryButton("I understand", symbol: "checkmark") { model.send(.acknowledgeSafety) }
        }
    }
}

private struct FirstCheckInView: View {
    let model: ProductFlowModel
    let area: BodyArea
    var body: some View {
        FlowPage(title: "You're ready", eyebrow: "Setup complete", symbol: "checkmark.seal.fill") {
            Label(area.title, systemImage: area.symbol)
                .font(.title2.weight(.semibold))
                .foregroundStyle(KineoColor.accent)
            Text("Your normal daily check-in asks only two questions. A follow-up appears only when an answer triggers it.")
                .foregroundStyle(.secondary)
            PrimaryButton("Check in for today", symbol: "arrow.right") { model.send(.completeOnboarding) }
        }
    }
}

private struct TodayTabsView: View {
    let model: ProductFlowModel
    let area: BodyArea
    let showsPrototypeResetControl: Bool

    var body: some View {
        TabView {
            FlowPage(title: "Today", eyebrow: "Your daily plan", symbol: "sun.max.fill") {
                TodayFocusCard(area: area) {
                    model.send(.startCheckIn)
                }

                if let progress = model.progress, !progress.isEmpty {
                    RhythmSummaryCard(participationDayCount: progress.participationDayCount)
                }

                if showsPrototypeResetControl {
                    PrototypeToolsCard {
                        model.send(.requestDeleteAll)
                    }
                }
            }
            .tabItem { Label("Today", systemImage: "sun.max") }
            ProgressTabView(progress: model.progress)
                .tabItem { Label("Progress", systemImage: "chart.line.uptrend.xyaxis") }
            ProfileTabView(model: model)
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .kineoTabChrome()
        .task { model.send(.loadDashboard) }
    }
}

private struct TodayFocusCard: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let area: BodyArea
    let startCheckIn: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            RoundedRectangle(cornerRadius: KineoLayout.heroRadius, style: .continuous)
                .fill(KineoColor.spotlightGradient)
            Circle()
                .fill(KineoColor.coralSurface)
                .frame(
                    width: KineoLayout.compactDecorativeOrbSize,
                    height: KineoLayout.compactDecorativeOrbSize
                )
                .padding(KineoLayout.standardSpacing)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: KineoLayout.standardSpacing) {
                HStack(alignment: .bottom, spacing: KineoLayout.smallSpacing) {
                    VStack(alignment: .leading, spacing: KineoLayout.smallSpacing) {
                        Label(area.title, systemImage: area.symbol)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(KineoColor.accent)
                            .padding(.horizontal, KineoLayout.smallSpacing)
                            .frame(minHeight: KineoLayout.minimumTouchTarget)
                            .background(.regularMaterial, in: Capsule())
                        Text("Your move for today starts here.")
                            .font(.title.bold())
                            .foregroundStyle(KineoColor.brandInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if !dynamicTypeSize.isAccessibilitySize {
                        Image("KineoHeroFigure", bundle: .module)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: KineoLayout.compactEditorialFigureWidth)
                            .accessibilityHidden(true)
                    }
                }
                Text("Tell Kineo how movement feels, then see the plan that matches your answers.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                PrimaryButton("Start today's check-in", symbol: "arrow.right", action: startCheckIn)
            }
            .padding(KineoLayout.heroCardPadding)
        }
        .shadow(
            color: KineoColor.accent.opacity(KineoLayout.shadowOpacity),
            radius: KineoLayout.shadowRadius,
            y: KineoLayout.shadowVerticalOffset
        )
    }
}

private struct RhythmSummaryCard: View {
    let participationDayCount: Int

    var body: some View {
        HStack(spacing: KineoLayout.standardSpacing) {
            KineoIconBadge(symbol: "calendar.badge.checkmark")
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: KineoLayout.hairlineSpacing) {
                Text("Your rhythm")
                    .font(.headline)
                Text("Consistency without streak pressure")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: KineoLayout.compactSpacing)
            VStack(alignment: .trailing, spacing: KineoLayout.hairlineSpacing) {
                Text(participationDayCount.formatted())
                    .font(.title.weight(.bold))
                    .foregroundStyle(KineoColor.accent)
                Text("days")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .cardStyle()
        .accessibilityElement(children: .combine)
    }
}

private struct PrototypeToolsCard: View {
    let startOver: () -> Void

    var body: some View {
        Button(action: startOver) {
            Label("Start over for testing", systemImage: "arrow.counterclockwise")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumTouchTarget)
        }
        .buttonStyle(.plain)
    }
}

private struct ProgressTabView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let progress: ProgressPresentation?

    var body: some View {
        FlowPage(title: "Progress", eyebrow: "Your local history", symbol: "chart.line.uptrend.xyaxis") {
            if let progress {
                if progress.isEmpty {
                    ProgressEmptyState()
                } else {
                    ProgressHeroCard(participationDayCount: progress.participationDayCount)
                    SectionHeader(
                        title: "By area",
                        detail: "A factual view of what you recorded"
                    )
                    ForEach(progress.areas, id: \.area) { area in
                        VStack(alignment: .leading, spacing: KineoLayout.standardSpacing) {
                            HStack(spacing: KineoLayout.smallSpacing) {
                                KineoIconBadge(symbol: area.area.symbol)
                                    .accessibilityHidden(true)
                                Text(area.area.localizedTitle)
                                    .font(.headline)
                                    .foregroundStyle(KineoColor.brandInk)
                                Spacer()
                                if let response = area.latestResponse {
                                    Label(response.title, systemImage: response.symbol)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(KineoColor.accent)
                                }
                            }
                            LazyVGrid(columns: metricColumns, spacing: KineoLayout.smallSpacing) {
                                CompactStat(value: area.recordedCheckInCount.formatted(), label: "check-ins")
                                CompactStat(value: area.completedRoutineCount.formatted(), label: "completed")
                                CompactStat(value: area.participationCount.formatted(), label: "participation")
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

    private var metricColumns: [GridItem] {
        let count = dynamicTypeSize.isAccessibilitySize ?
            KineoLayout.accessibilityMetricColumnCount : KineoLayout.regularProgressStatColumnCount
        return Array(repeating: GridItem(.flexible(), spacing: KineoLayout.smallSpacing), count: count)
    }
}

private struct ProgressEmptyState: View {
    var body: some View {
        VStack(spacing: KineoLayout.standardSpacing) {
            ZStack {
                Circle()
                    .fill(KineoColor.accentSurface)
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: KineoLayout.heroSymbolPointSize, weight: .semibold))
                    .foregroundStyle(KineoColor.accent)
                    .accessibilityHidden(true)
            }
            .frame(width: KineoLayout.heroMarkSize, height: KineoLayout.heroMarkSize)
            Text("No history yet")
                .font(.title2.weight(.bold))
                .foregroundStyle(KineoColor.brandInk)
            Text("Completed routines, intentional stops, and Pause Today participation will appear here.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(KineoLayout.heroCardPadding)
        .frame(maxWidth: .infinity)
        .background(KineoColor.elevatedSurface)
        .clipShape(RoundedRectangle(
            cornerRadius: KineoLayout.heroRadius,
            style: .continuous
        ))
        .accessibilityElement(children: .combine)
    }
}

private struct ProgressHeroCard: View {
    let participationDayCount: Int

    var body: some View {
        HStack(spacing: KineoLayout.standardSpacing) {
            VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
                Text("Your rhythm")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(KineoColor.accent)
                    .textCase(.uppercase)
                Text("Keep showing up in a way that fits your day.")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(KineoColor.brandInk)
                    .fixedSize(horizontal: false, vertical: true)
                Text("No streaks or recovery scores")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: KineoLayout.compactSpacing)
            VStack(spacing: KineoLayout.hairlineSpacing) {
                Text(participationDayCount.formatted())
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                Text("days")
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(KineoColor.accent)
            .frame(
                width: KineoLayout.progressRingSize,
                height: KineoLayout.progressRingSize
            )
            .background(
                KineoColor.highlight,
                in: Circle()
            )
        }
        .padding(KineoLayout.heroCardPadding)
        .background(KineoColor.spotlightGradient)
        .clipShape(RoundedRectangle(
            cornerRadius: KineoLayout.heroRadius,
            style: .continuous
        ))
        .accessibilityElement(children: .combine)
    }
}

private struct CompactStat: View {
    let value: String
    let label: LocalizedStringKey

    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.hairlineSpacing) {
            Text(value)
                .font(.title2.weight(.bold))
                .foregroundStyle(KineoColor.brandInk)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct ProfileTabView: View {
    @Environment(\.openURL) private var openURL
    @State private var expandedSections: Set<ProfileSection> = []
    let model: ProductFlowModel

    var body: some View {
        FlowPage(title: "Profile", eyebrow: "Preferences and privacy", symbol: "person.crop.circle.fill") {
            if let profile = model.profile {
                LocalPrivacyBanner()

                ProfileDisclosureCard(
                    title: "Areas",
                    summary: areaSummary,
                    symbol: "scope",
                    isExpanded: expansionBinding(for: .areas)
                ) {
                    SectionHeader(title: "Primary area")
                    ForEach(BodyArea.allCases, id: \.self) { area in
                        ChoiceCard(
                            title: area.localizedTitle,
                            symbol: area.symbol,
                            selected: model.profileDraftPrimary == area
                        ) {
                            model.send(.selectProfilePrimary(area))
                        }
                    }
                    SectionHeader(title: "Optional secondary")
                    ChoiceCard(title: "None", symbol: "minus", selected: model.profileDraftSecondary == nil) {
                        model.send(.selectProfileSecondary(nil))
                    }
                    ForEach(BodyArea.allCases.filter { $0 != model.profileDraftPrimary }, id: \.self) { area in
                        ChoiceCard(
                            title: area.localizedTitle,
                            symbol: area.symbol,
                            selected: model.profileDraftSecondary == area
                        ) {
                            model.send(.selectProfileSecondary(area))
                        }
                    }
                    PrimaryButton("Save areas", symbol: "checkmark") { model.send(.saveProfileAreas) }
                }

                ProfileDisclosureCard(
                    title: "Reminders",
                    summary: reminderSummary(for: profile),
                    symbol: "bell",
                    isExpanded: expansionBinding(for: .reminders)
                ) {
                    if profile.reminderAuthorization == .denied {
                        NoticeCard(
                            title: "Notifications are off",
                            message: "Your preferred window stays saved, and Kineo still works normally."
                        )
                        #if canImport(UIKit)
                        if let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                            SecondaryButton("Open iPhone Settings", symbol: "gear") { openURL(settingsURL) }
                        }
                        #endif
                    } else if profile.reminderSettings?.enabled == true {
                        NoticeCard(title: "Reminder on", message: "One generic daily reminder is scheduled.")
                        SecondaryButton("Turn reminders off", symbol: "bell.slash") { model.send(.disableReminder) }
                    } else {
                        Text("Choose a general window. Kineo never infers an ideal time.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        ForEach(ReminderWindowChoice.allCases, id: \.self) { choice in
                            SecondaryButton("Use a \(choice.title.lowercased()) reminder", symbol: "bell.badge") {
                                model.send(.enableReminder(choice))
                            }
                        }
                    }
                }

                ProfileDisclosureCard(
                    title: "Privacy and data",
                    summary: "Local storage, reset, and deletion",
                    symbol: "lock.shield",
                    isExpanded: expansionBinding(for: .privacy)
                ) {
                    Text("Your areas, check-ins, routines, and responses stay in Kineo on this iPhone. This prototype sends no Kineo analytics.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    SecondaryButton("Reset history", symbol: "arrow.counterclockwise") {
                        model.send(.requestResetHistory)
                    }
                    DestructiveButton("Delete all Kineo data") { model.send(.requestDeleteAll) }
                }

                ProfileDisclosureCard(
                    title: "Safety and support",
                    summary: "Product limits and prototype status",
                    symbol: "shield.lefthalf.filled",
                    isExpanded: expansionBinding(for: .safety)
                ) {
                    NoticeCard(
                        title: "Movement planning, not treatment",
                        message: "Kineo does not diagnose or treat a condition. If an answer activates Attention Required, Kineo withholds new routines until you confirm that area has returned to its usual recurring pattern."
                    )
                    NoticeCard(
                        title: "Internal prototype",
                        message: "Use the in-app safety control whenever something feels wrong during a routine. Public-facing guidance and support details require professional review before release."
                    )
                }
            } else {
                ProgressView("Loading profile…")
            }
        }
    }

    private var areaSummary: String {
        guard let primary = model.profileDraftPrimary else { return "Choose your areas" }
        guard let secondary = model.profileDraftSecondary else { return primary.title }
        return "\(primary.title) + \(secondary.title)"
    }

    private func reminderSummary(for profile: ProfilePresentation) -> String {
        if profile.reminderAuthorization == .denied { return "Off in iPhone Settings" }
        if profile.reminderSettings?.enabled == true { return "One daily reminder" }
        return "Off"
    }

    private func expansionBinding(for section: ProfileSection) -> Binding<Bool> {
        Binding(
            get: { expandedSections.contains(section) },
            set: { isExpanded in
                if isExpanded {
                    expandedSections.insert(section)
                } else {
                    expandedSections.remove(section)
                }
            }
        )
    }

    private enum ProfileSection: Hashable {
        case areas
        case reminders
        case privacy
        case safety
    }
}

private struct LocalPrivacyBanner: View {
    var body: some View {
        HStack(spacing: KineoLayout.smallSpacing) {
            Image(systemName: "iphone.gen3.badge.checkmark")
                .font(.title2)
                .foregroundStyle(KineoColor.accent)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: KineoLayout.hairlineSpacing) {
                Text("Local by design")
                    .font(.headline)
                    .foregroundStyle(KineoColor.brandInk)
                Text("Preferences and movement history stay in Kineo on this iPhone.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(KineoLayout.standardSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KineoColor.accentSurface)
        .clipShape(RoundedRectangle(
            cornerRadius: KineoLayout.controlRadius,
            style: .continuous
        ))
        .accessibilityElement(children: .combine)
    }
}

private struct ProfileDisclosureCard<Content: View>: View {
    let title: LocalizedStringKey
    let summary: String
    let symbol: String
    @Binding var isExpanded: Bool
    @ViewBuilder let content: Content

    init(
        title: LocalizedStringKey,
        summary: String,
        symbol: String,
        isExpanded: Binding<Bool>,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.summary = summary
        self.symbol = symbol
        _isExpanded = isExpanded
        self.content = content()
    }

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: KineoLayout.standardSpacing) {
                Divider()
                content
            }
            .padding(.top, KineoLayout.smallSpacing)
        } label: {
            HStack(spacing: KineoLayout.standardSpacing) {
                KineoIconBadge(symbol: symbol)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: KineoLayout.hairlineSpacing) {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(KineoColor.brandInk)
                    Text(summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .tint(KineoColor.accent)
        .padding(KineoLayout.standardSpacing)
        .background(isExpanded ? KineoColor.elevatedSurface : KineoColor.subduedSurface)
        .clipShape(RoundedRectangle(cornerRadius: KineoLayout.cardRadius, style: .continuous))
    }
}

private struct ChangeCheckInView: View {
    let model: ProductFlowModel
    let draft: CheckInDraft
    var body: some View {
        let area = model.currentCheckInArea ?? draft.area
        FlowPage(title: "How does \(area.title.lowercased()) feel today?", symbol: area.symbol) {
            KineoFlowProgressView(progress: .checkIn(question: .change))
            KineoContextPill(
                title: area == draft.area ? "Primary · \(area.title)" : "Secondary · \(area.title)",
                symbol: area.symbol
            )
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
        FlowPage(title: "How comfortable does movement feel?", symbol: "figure.walk.motion") {
            KineoFlowProgressView(progress: .checkIn(question: .movementComfort))
            KineoContextPill(title: area.title, symbol: area.symbol)
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
        FlowPage(title: "One follow-up for \(area.title.lowercased())", eyebrow: "A change needs context", symbol: "exclamationmark.triangle") {
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
        FlowPage(title: "Your plan", eyebrow: "Ready for today", symbol: "sparkles") {
            PlanSummaryHero(plan: plan)
            if let omitted = plan.omittedSecondaryArea {
                NoticeCard(
                    title: "Primary-area plan",
                    message: "\(omitted.title) is not included in this routine. Kineo did not substitute unapproved content."
                )
            }
            SectionHeader(
                title: "Choose your pace",
                detail: "Both are complete \(plan.deliveredLevel.title) routines"
            )
            ViewThatFits(in: .horizontal) {
                HStack(spacing: KineoLayout.smallSpacing) {
                    durationButtons
                }
                VStack(spacing: KineoLayout.smallSpacing) {
                    durationButtons
                }
            }
            if let gentler = plan.selectedLevel.gentlerLevel {
                SecondaryButton("Choose \(gentler.title) instead") { model.send(.chooseGentlerLevel(gentler)) }
            }
            PrimaryButton("Start routine", symbol: "play.fill") { model.send(.startRoutine) }
            if plan.pauseTodayAvailable {
                SecondaryButton("Pause for today") { model.send(.pauseToday) }
            }
            Text("Changing duration changes reviewed content, not the selected movement level.").font(.footnote).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var durationButtons: some View {
        DurationButton(duration: .quick, selected: plan.duration == .quick) {
            model.send(.chooseDuration(.quick))
        }
        DurationButton(duration: .standard, selected: plan.duration == .standard) {
            model.send(.chooseDuration(.standard))
        }
    }
}

private struct PlanSummaryHero: View {
    let plan: PlanPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.standardSpacing) {
            HStack {
                Label("Today's movement level", systemImage: plan.deliveredLevel.symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KineoColor.accent)
                Spacer()
                KineoIconBadge(
                    symbol: "sparkles",
                    foregroundStyle: KineoColor.coral,
                    backgroundStyle: KineoColor.coralSurface
                )
                .accessibilityHidden(true)
            }
            Text(plan.deliveredLevel.title)
                .font(.largeTitle.bold())
                .foregroundStyle(KineoColor.brandInk)
            Text(plan.explanationText)
                .font(.title3.weight(.medium))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: KineoLayout.compactSpacing) {
                    metadataPills
                }
                VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
                    metadataPills
                }
            }
        }
        .padding(KineoLayout.heroCardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KineoColor.elevatedSurface)
        .clipShape(RoundedRectangle(
            cornerRadius: KineoLayout.heroRadius,
            style: .continuous
        ))
        .overlay(alignment: .top) {
            Capsule()
                .fill(KineoColor.highlight)
                .frame(height: KineoLayout.hairlineSpacing)
                .padding(.horizontal, KineoLayout.heroCardPadding)
        }
        .shadow(
            color: KineoColor.accent.opacity(KineoLayout.shadowOpacity),
            radius: KineoLayout.shadowRadius,
            y: KineoLayout.shadowVerticalOffset
        )
    }

    @ViewBuilder
    private var metadataPills: some View {
        PlanMetadataPill(
            title: plan.includedAreas.map(\.title).joined(separator: " + "),
            symbol: "scope"
        )
        PlanMetadataPill(
            title: "\(plan.itemCount.formatted()) steps · \(plan.nominalMinutes.formatted()) min",
            symbol: "clock"
        )
    }
}

private struct PlanMetadataPill: View {
    let title: String
    let symbol: String

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(KineoColor.brandInk)
            .padding(.horizontal, KineoLayout.smallSpacing)
            .padding(.vertical, KineoLayout.compactSpacing)
            .background(
                KineoColor.subduedSurface,
                in: Capsule()
            )
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let model: ProductFlowModel
    let routine: RoutinePresentation
    var body: some View {
        FlowPage(title: "Guided routine", eyebrow: "Move at your pace", symbol: "figure.flexibility") {
            if routine.contentAvailable {
                if routine.currentItem != nil {
                    RoutineProgressHeader(
                        currentStep: routine.currentStepIndex + KineoLayout.humanIndexOffset,
                        totalStepCount: routine.totalStepCount,
                        isPaused: routine.status == .paused,
                        pausedFocused: $pausedFocused
                    )
                    Text(routine.presentedTitle)
                        .font(.title.bold())
                        .foregroundStyle(KineoColor.brandInk)
                        .fixedSize(horizontal: false, vertical: true)
                    PrototypeExerciseVideoPreview(
                        isRoutinePaused: routine.status == .paused
                    )
                    if let instruction = routine.presentedInstruction {
                        VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
                            Text("How to move")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(KineoColor.accent)
                                .textCase(.uppercase)
                            Text(instruction)
                                .font(.title3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    if let safetyCue = routine.presentedSafetyCue {
                        NoticeCard(
                            title: "Movement cue",
                            message: LocalizedStringKey(safetyCue)
                        )
                    }
                    if let dose = routine.presentedDose {
                        RoutineDoseCard(
                            kind: dose.kind,
                            timerText: routine.timerText(for: dose),
                            doseText: dose.presentationText
                        )
                    }
                    if routine.selectedAlternative != nil {
                        Label("Approved alternative selected", systemImage: "arrow.triangle.branch")
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(KineoColor.accent)
                    }
                }
                SectionHeader(title: "Controls", detail: "The routine pauses before any interruption")
                LazyVGrid(columns: routineControlColumns, spacing: KineoLayout.smallSpacing) {
                    if routine.status != .paused {
                        RoutineActionButton(title: "Pause", symbol: "pause.fill") {
                            model.send(.pauseRoutine)
                        }
                        RoutineActionButton(title: "Skip this step", symbol: "forward.end.fill") {
                            model.send(.skipRoutineStep(nil))
                        }
                    }
                    if routine.currentItem?.availableAlternatives.isEmpty == false {
                        RoutineActionButton(title: "Alternative", symbol: "arrow.triangle.branch") {
                            model.send(.requestAlternative)
                        }
                    }
                    RoutineActionButton(title: "End routine", symbol: "xmark") {
                        model.send(.requestEndRoutine)
                    }
                }
            } else {
                NoticeCard(
                    title: "Content unavailable",
                    message: "A required installed asset could not be verified. Kineo will not play a partial routine."
                )
                PrimaryButton("End incomplete routine") { model.send(.requestEndRoutine) }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: .zero) {
            if routine.contentAvailable {
                VStack(spacing: .zero) {
                    Divider()
                    VStack(spacing: KineoLayout.smallSpacing) {
                        SafetyButton(title: "Something feels wrong") {
                            model.send(.somethingFeelsWrong)
                        }
                        routinePrimaryAction
                    }
                        .padding(.horizontal, KineoLayout.screenMargin)
                        .padding(.vertical, KineoLayout.smallSpacing)
                }
                .background(.ultraThinMaterial)
            }
        }
        .task(id: routine.status) {
            if routine.status == .paused { pausedFocused = true }
        }
    }

    @ViewBuilder
    private var routinePrimaryAction: some View {
        if routine.status == .paused {
            PrimaryButton("Resume", symbol: "play.fill") { model.send(.resumeRoutine) }
        } else if routine.isLastStep {
            PrimaryButton("Complete routine", symbol: "checkmark") { model.send(.advanceRoutine) }
        } else {
            PrimaryButton("Complete step", symbol: "arrow.right") { model.send(.advanceRoutine) }
        }
    }

    private var routineControlColumns: [GridItem] {
        let count = dynamicTypeSize.isAccessibilitySize ?
            KineoLayout.accessibilityMetricColumnCount : KineoLayout.regularMetricColumnCount
        return Array(
            repeating: GridItem(.flexible(), spacing: KineoLayout.smallSpacing),
            count: count
        )
    }
}

private struct RoutineProgressHeader: View {
    let currentStep: Int
    let totalStepCount: Int
    let isPaused: Bool
    let pausedFocused: AccessibilityFocusState<Bool>.Binding

    var body: some View {
        VStack(spacing: KineoLayout.compactSpacing) {
            HStack {
                Text("Step \(currentStep.formatted()) of \(totalStepCount.formatted())")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(KineoColor.accent)
                    .textCase(.uppercase)
                Spacer()
                if isPaused {
                    Label("Paused", systemImage: "pause.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(KineoColor.attentionText)
                        .accessibilityHeading(.h2)
                        .accessibilityFocused(pausedFocused)
                }
            }
            KineoLinearProgressView(
                value: Double(currentStep),
                total: Double(totalStepCount),
                accessibilityLabel: "Routine progress",
                accessibilityValue: "Step \(currentStep) of \(totalStepCount)"
            )
        }
    }
}

enum RoutineDoseAccessibilityKind: Equatable {
    case timer
    case repetitions

    var label: LocalizedStringKey {
        switch self {
        case .timer: "Routine timer"
        case .repetitions: "Routine repetitions"
        }
    }
}

struct RoutineDoseAccessibilityContent: Equatable {
    let kind: RoutineDoseAccessibilityKind
    let doseText: String
    let timerText: String

    var value: String {
        String(localized: "\(doseText). \(timerText).")
    }

    init(kind: DoseKind, timerText: String, doseText: String) {
        self.kind = switch kind {
        case .timed: .timer
        case .repetitions: .repetitions
        }
        self.doseText = doseText
        self.timerText = timerText
    }
}

private struct RoutineDoseCard: View {
    let kind: DoseKind
    let timerText: String
    let doseText: String

    private var accessibilityContent: RoutineDoseAccessibilityContent {
        RoutineDoseAccessibilityContent(
            kind: kind,
            timerText: timerText,
            doseText: doseText
        )
    }

    var body: some View {
        HStack(spacing: KineoLayout.standardSpacing) {
            KineoIconBadge(symbol: kind == .timed ? "timer" : "repeat")
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: KineoLayout.hairlineSpacing) {
                Text(timerText)
                    .font(.title2.monospacedDigit().weight(.bold))
                    .foregroundStyle(KineoColor.brandInk)
                    .fixedSize(horizontal: false, vertical: true)
                Text(doseText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(KineoLayout.standardSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KineoColor.accentSurface)
        .clipShape(RoundedRectangle(
            cornerRadius: KineoLayout.controlRadius,
            style: .continuous
        ))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("Routine dose")
        .accessibilityLabel(accessibilityContent.kind.label)
        .accessibilityValue(accessibilityContent.value)
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
            ZStack {
                Circle()
                    .fill(KineoColor.accentSurface)
                Image(systemName: "checkmark")
                    .font(.system(size: KineoLayout.heroSymbolPointSize, weight: .bold))
                    .foregroundStyle(KineoColor.accent)
                    .accessibilityHidden(true)
            }
            .frame(width: KineoLayout.heroMarkSize, height: KineoLayout.heroMarkSize)
            Text("Nice work showing up today.")
                .font(.title2.weight(.semibold))
                .foregroundStyle(KineoColor.brandInk)
            Text("Your \(area.title.lowercased()) routine and optional response are saved locally.")
                .foregroundStyle(.secondary)
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

private struct DurationButton: View {
    let duration: DurationVariant
    let selected: Bool
    let action: () -> Void
    var body: some View {
        ChoiceCard(
            title: duration.localizedTitle,
            subtitle: duration.selectionSubtitle,
            symbol: duration.symbol,
            selected: selected,
            action: action
        )
    }
}

private extension BodyArea {
    var title: String { switch self { case .neck: "Neck"; case .upperMidBack: "Upper or mid-back"; case .lowerBack: "Lower back" } }
    var symbol: String {
        switch self {
        case .neck: "figure.stand"
        case .upperMidBack: "figure.mind.and.body"
        case .lowerBack: "figure.core.training"
        }
    }
    var selectionSubtitle: LocalizedStringKey {
        switch self {
        case .neck: "Neck and nearby movement focus"
        case .upperMidBack: "Upper and middle back focus"
        case .lowerBack: "Lower back movement focus"
        }
    }
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
    var symbol: String { switch self { case .quick: "timer"; case .standard: "clock.fill" } }
    var localizedTitle: LocalizedStringKey {
        switch self {
        case .quick: "Quick"
        case .standard: "Standard"
        }
    }
    var selectionSubtitle: LocalizedStringKey {
        switch self {
        case .quick: "Short and complete"
        case .standard: "Full daily routine"
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

    var symbol: String {
        switch self {
        case .better: "arrow.up"
        case .same: "arrow.right"
        case .worse: "arrow.down"
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

#Preview { KineoRootView(launchState: .foundationReady) }
