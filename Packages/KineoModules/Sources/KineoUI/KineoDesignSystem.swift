import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

enum KineoColor {
    static let accent = Color(red: 0.08, green: 0.29, blue: 0.25)
    static let pressedAccent = Color(red: 0.05, green: 0.22, blue: 0.19)
    static let highlight = adaptiveColor(
        light: (0.84, 0.94, 0.38),
        dark: (0.70, 0.82, 0.30)
    )
    static let coral = adaptiveColor(
        light: (0.97, 0.48, 0.37),
        dark: (1.00, 0.60, 0.50)
    )
    static let brandInk = adaptiveColor(
        light: (0.08, 0.13, 0.12),
        dark: (0.94, 0.96, 0.94)
    )
    static let accentSurface = adaptiveColor(
        light: (0.88, 0.95, 0.91),
        dark: (0.10, 0.21, 0.18)
    )
    static let highlightSurface = adaptiveColor(
        light: (0.93, 0.97, 0.72),
        dark: (0.20, 0.25, 0.10)
    )
    static let coralSurface = adaptiveColor(
        light: (1.00, 0.89, 0.85),
        dark: (0.27, 0.13, 0.10)
    )
    static let canvas = adaptiveColor(
        light: (0.96, 0.95, 0.91),
        dark: (0.05, 0.06, 0.06)
    )
    static let elevatedSurface = adaptiveColor(
        light: (1.00, 0.99, 0.95),
        dark: (0.10, 0.12, 0.11)
    )
    static let subduedSurface = adaptiveColor(
        light: (0.92, 0.91, 0.87),
        dark: (0.14, 0.16, 0.15)
    )
    static let attentionSurface = adaptiveColor(
        light: (1.00, 0.95, 0.87),
        dark: (0.24, 0.17, 0.09)
    )
    static let attentionText = adaptiveColor(
        light: (0.48, 0.28, 0.07),
        dark: (1.00, 0.79, 0.49)
    )
    static let separator = Color.primary.opacity(KineoLayout.separatorOpacity)

    static let brandGradient = LinearGradient(
        colors: [pressedAccent, accent],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let spotlightGradient = LinearGradient(
        colors: [highlightSurface, accentSurface],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    private static func adaptiveColor(
        light: (red: Double, green: Double, blue: Double),
        dark: (red: Double, green: Double, blue: Double)
    ) -> Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor { traits in
            let components = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: components.red,
                green: components.green,
                blue: components.blue,
                alpha: KineoLayout.opaqueColorAlpha
            )
        })
        #else
        Color(red: light.red, green: light.green, blue: light.blue)
        #endif
    }
}

enum KineoLayout {
    static let hairlineSpacing: CGFloat = 4
    static let compactSpacing: CGFloat = 8
    static let smallSpacing: CGFloat = 12
    static let standardSpacing: CGFloat = 16
    static let screenMargin: CGFloat = 20
    static let sectionSpacing: CGFloat = 24
    static let spaciousSectionSpacing: CGFloat = 32
    static let minimumTouchTarget: CGFloat = 44
    static let minimumPrimaryControlHeight: CGFloat = 54
    static let choiceSymbolSize: CGFloat = 38
    static let heroSymbolPointSize: CGFloat = 42
    static let brandMarkSize: CGFloat = 36
    static let heroMarkSize: CGFloat = 96
    static let heroArtworkHeight: CGFloat = 236
    static let editorialArtworkHeight: CGFloat = 310
    static let editorialFigureWidth: CGFloat = 220
    static let compactEditorialFigureWidth: CGFloat = 132
    static let artworkOverflowOffset: CGFloat = 18
    static let decorativeOrbSize: CGFloat = 150
    static let compactDecorativeOrbSize: CGFloat = 88
    static let heroArtworkSymbolSize: CGFloat = 76
    static let heroCardPadding: CGFloat = 24
    static let iconBadgeSize: CGFloat = 40
    static let progressRingSize: CGFloat = 92
    static let routineMediaHeight: CGFloat = 270
    static let decorativePathWidth: CGFloat = 180
    static let decorativePathHeight: CGFloat = 150
    static let controlRadius: CGFloat = 16
    static let cardRadius: CGFloat = 24
    static let heroRadius: CGFloat = 28
    static let standardBorderWidth: CGFloat = 1
    static let selectedBorderWidth: CGFloat = 2
    static let buttonPressedScale = 0.98
    static let disabledOpacity = 0.45
    static let unselectedOpacity = 0.72
    static let separatorOpacity = 0.12
    static let shadowOpacity = 0.09
    static let shadowRadius: CGFloat = 22
    static let shadowVerticalOffset: CGFloat = 10
    static let decorativeOpacity = 0.14
    static let backgroundGlowOpacity = 0.42
    static let mutedBackgroundGlowOpacity = 0.22
    static let progressTrackOpacity = 0.14
    static let opaqueColorAlpha = 1.0
    static let regularMetricColumnCount = 2
    static let regularProgressStatColumnCount = 3
    static let accessibilityMetricColumnCount = 1
    static let secondsPerMinute = 60
    static let millisecondsPerSecond: Int64 = 1_000
    static let countdownRoundingOffset = millisecondsPerSecond - 1
    static let noElapsedMilliseconds: Int64 = 0
    static let humanIndexOffset = 1
}

enum KineoProductCopy {
    static let minimumSupportedAge = 18
}

struct FlowPage<Content: View>: View {
    @AccessibilityFocusState private var titleFocused: Bool
    let title: LocalizedStringKey
    let eyebrow: LocalizedStringKey?
    let symbol: String?
    @ViewBuilder let content: Content

    init(
        title: LocalizedStringKey,
        eyebrow: LocalizedStringKey? = nil,
        symbol: String? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.eyebrow = eyebrow
        self.symbol = symbol
        self.content = content()
    }

    var body: some View {
        ZStack {
            KineoBackdrop()
            ScrollView {
                VStack(alignment: .leading, spacing: KineoLayout.sectionSpacing) {
                    pageHeader
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, KineoLayout.screenMargin)
                .padding(.top, KineoLayout.smallSpacing)
                .padding(.bottom, KineoLayout.spaciousSectionSpacing)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle("")
        .kineoNavigationChrome()
        .task { titleFocused = true }
    }

    private var pageHeader: some View {
        HStack(alignment: .top, spacing: KineoLayout.standardSpacing) {
            VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
                if let eyebrow {
                    Text(eyebrow)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(KineoColor.accent)
                        .textCase(.uppercase)
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(title)
                    .font(.title.bold())
                    .foregroundStyle(KineoColor.brandInk)
                    .accessibilityHeading(.h1)
                    .accessibilityFocused($titleFocused)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let symbol {
                KineoIconBadge(symbol: symbol)
                    .accessibilityHidden(true)
            }
        }
    }
}

struct KineoBackdrop: View {
    var body: some View {
        ZStack(alignment: .topTrailing) {
            LinearGradient(
                colors: [KineoColor.elevatedSurface, KineoColor.canvas],
                startPoint: .top,
                endPoint: .bottom
            )
            Circle()
                .fill(KineoColor.highlightSurface.opacity(KineoLayout.backgroundGlowOpacity))
                .frame(
                    width: KineoLayout.decorativeOrbSize,
                    height: KineoLayout.decorativeOrbSize
                )
                .offset(
                    x: KineoLayout.sectionSpacing,
                    y: -KineoLayout.spaciousSectionSpacing
                )
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

struct KineoWordmark: View {
    var body: some View {
        HStack(spacing: KineoLayout.compactSpacing) {
            ZStack {
                RoundedRectangle(
                    cornerRadius: KineoLayout.smallSpacing,
                    style: .continuous
                )
                .fill(KineoColor.highlight)
                KineoMovementPath()
                    .stroke(
                        KineoColor.accent,
                        style: StrokeStyle(
                            lineWidth: KineoLayout.selectedBorderWidth,
                            lineCap: .round
                        )
                    )
                    .padding(KineoLayout.compactSpacing)
            }
            .frame(width: KineoLayout.brandMarkSize, height: KineoLayout.brandMarkSize)
            .accessibilityHidden(true)
            Text("Kineo")
                .font(.title3.weight(.bold))
                .foregroundStyle(KineoColor.brandInk)
        }
    }
}

struct KineoIconBadge: View {
    let symbol: String
    var foregroundStyle: Color = KineoColor.accent
    var backgroundStyle: Color = KineoColor.accentSurface

    var body: some View {
        Image(systemName: symbol)
            .font(.headline.weight(.semibold))
            .foregroundStyle(foregroundStyle)
            .frame(width: KineoLayout.iconBadgeSize, height: KineoLayout.iconBadgeSize)
            .background(backgroundStyle, in: RoundedRectangle(
                cornerRadius: KineoLayout.smallSpacing,
                style: .continuous
            ))
    }
}

struct KineoMovementPath: Shape {
    private static let firstControlXRatio = 0.40
    private static let firstControlYRatio = 0.12
    private static let secondControlXRatio = 0.78
    private static let secondControlYRatio = 0.88

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addCurve(
            to: CGPoint(x: rect.minX, y: rect.maxY),
            control1: CGPoint(
                x: rect.width * Self.firstControlXRatio,
                y: rect.height * Self.firstControlYRatio
            ),
            control2: CGPoint(
                x: rect.width * Self.secondControlXRatio,
                y: rect.height * Self.secondControlYRatio
            )
        )
        return path
    }
}

struct KineoHeroArtwork: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: KineoLayout.heroRadius, style: .continuous)
                .fill(KineoColor.spotlightGradient)
            Circle()
                .fill(KineoColor.coralSurface)
                .frame(
                    width: KineoLayout.decorativeOrbSize,
                    height: KineoLayout.decorativeOrbSize
                )
                .offset(
                    x: KineoLayout.decorativePathWidth,
                    y: -KineoLayout.heroMarkSize
                )
            Image("KineoHeroFigure", bundle: .module)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: KineoLayout.editorialFigureWidth)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .offset(x: KineoLayout.artworkOverflowOffset)
                .accessibilityHidden(true)
            Label("Built around how today feels", systemImage: "sparkles")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(KineoColor.brandInk)
                .padding(.horizontal, KineoLayout.standardSpacing)
                .padding(.vertical, KineoLayout.smallSpacing)
                .background(.regularMaterial, in: Capsule())
                .padding(KineoLayout.standardSpacing)
        }
        .frame(maxWidth: .infinity, minHeight: KineoLayout.editorialArtworkHeight)
        .clipped()
        .accessibilityElement(children: .combine)
    }
}

enum KineoOnboardingStage: CaseIterable {
    case eligibility
    case primaryArea
    case secondaryArea
    case safety

    var position: Int {
        Self.allCases.prefix { $0 != self }.count + KineoLayout.humanIndexOffset
    }
}

enum KineoCheckInQuestion: CaseIterable {
    case change
    case movementComfort

    var position: Int {
        Self.allCases.prefix { $0 != self }.count + KineoLayout.humanIndexOffset
    }
}

enum KineoFlowProgress: Equatable {
    case onboarding(stage: KineoOnboardingStage)
    case checkIn(question: KineoCheckInQuestion)

    var current: Int {
        switch self {
        case .onboarding(let stage): stage.position
        case .checkIn(let question): question.position
        }
    }

    var total: Int {
        switch self {
        case .onboarding: KineoOnboardingStage.allCases.count
        case .checkIn: KineoCheckInQuestion.allCases.count
        }
    }

    var title: LocalizedStringKey {
        switch self {
        case .onboarding: "Getting started"
        case .checkIn: "Daily check-in"
        }
    }

    var accessibilityLabel: LocalizedStringKey {
        switch self {
        case .onboarding: "Onboarding progress"
        case .checkIn: "Check-in progress"
        }
    }

    var valueText: String {
        switch self {
        case .onboarding(let stage): "Step \(stage.position) of \(total)"
        case .checkIn(let question): "Question \(question.position) of \(total)"
        }
    }
}

struct KineoFlowProgressView: View {
    let progress: KineoFlowProgress

    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
            HStack {
                Text(progress.title)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(KineoColor.accent)
                    .textCase(.uppercase)
                Spacer()
                Text(progress.valueText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            KineoLinearProgressView(
                value: Double(progress.current),
                total: Double(progress.total),
                accessibilityLabel: progress.accessibilityLabel,
                accessibilityValue: progress.valueText
            )
        }
    }
}

struct KineoLinearProgressView: View {
    let value: Double
    let total: Double
    let accessibilityLabel: LocalizedStringKey
    let accessibilityValue: String

    var body: some View {
        ZStack {
            ProgressView(value: value, total: total)
                .progressViewStyle(.linear)
                .tint(KineoColor.accent)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumTouchTarget)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(accessibilityValue)
    }
}

struct KineoContextPill: View {
    let title: String
    let symbol: String

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(KineoColor.accent)
            .padding(.horizontal, KineoLayout.smallSpacing)
            .frame(minHeight: KineoLayout.minimumTouchTarget)
            .background(KineoColor.accentSurface, in: Capsule())
    }
}

struct SectionHeader: View {
    let title: LocalizedStringKey
    var detail: LocalizedStringKey?

    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.hairlineSpacing) {
            Text(title)
                .font(.headline)
                .accessibilityHeading(.h2)
            if let detail {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct ChoiceCard: View {
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor
    let title: LocalizedStringKey
    var subtitle: LocalizedStringKey?
    var symbol: String?
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: KineoLayout.standardSpacing) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.headline)
                        .foregroundStyle(KineoColor.accent)
                        .frame(width: KineoLayout.choiceSymbolSize, height: KineoLayout.choiceSymbolSize)
                        .background(
                            selected ? KineoColor.highlight : KineoColor.accentSurface,
                            in: RoundedRectangle(
                                cornerRadius: KineoLayout.smallSpacing,
                                style: .continuous
                            )
                        )
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: KineoLayout.hairlineSpacing) {
                    Text(title)
                        .font(.headline)
                    if let subtitle {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(KineoColor.accent)
                        .accessibilityHidden(true)
                }
            }
            .padding(KineoLayout.standardSpacing)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight, alignment: .leading)
            .background(selected ? KineoColor.highlightSurface : KineoColor.elevatedSurface)
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous)
                    .stroke(
                        selected ? KineoColor.accent : KineoColor.separator,
                        lineWidth: borderWidth
                    )
            }
            .shadow(
                color: KineoColor.brandInk.opacity(selected ? KineoLayout.shadowOpacity : .zero),
                radius: KineoLayout.smallSpacing,
                y: KineoLayout.hairlineSpacing
            )
        }
        .buttonStyle(KineoChoiceButtonStyle())
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(selected ? "Selected" : "Not selected"))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityHint(
            differentiateWithoutColor && selected ?
                "A checkmark also shows this choice is selected." : ""
        )
    }

    private var borderWidth: CGFloat {
        if selected || contrast == .increased { return KineoLayout.selectedBorderWidth }
        return KineoLayout.standardBorderWidth
    }

}

private struct KineoChoiceButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? KineoLayout.buttonPressedScale : 1)
            .opacity(configuration.isPressed ? KineoLayout.unselectedOpacity : 1)
    }
}

struct NoticeCard: View {
    enum Tone: Equatable { case information, attention }

    let title: LocalizedStringKey
    let message: LocalizedStringKey
    var tone: Tone = .information

    var body: some View {
        HStack(alignment: .top, spacing: KineoLayout.smallSpacing) {
            Image(systemName: tone == .attention ? "exclamationmark.triangle.fill" : "info.circle.fill")
                .font(.title3)
                .foregroundStyle(foregroundColor)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
                Text(title)
                    .font(.headline)
                Text(message)
                    .foregroundStyle(tone == .attention ? foregroundColor : Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(KineoLayout.standardSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(backgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous))
        .overlay(alignment: .leading) {
            Capsule()
                .fill(foregroundColor)
                .frame(width: KineoLayout.hairlineSpacing)
                .padding(.vertical, KineoLayout.standardSpacing)
        }
        .accessibilityElement(children: .combine)
    }

    private var foregroundColor: Color {
        tone == .attention ? KineoColor.attentionText : KineoColor.accent
    }

    private var backgroundColor: Color {
        tone == .attention ? KineoColor.attentionSurface : KineoColor.accentSurface
    }
}

struct PrimaryButton: View {
    let title: LocalizedStringKey
    let symbol: String?
    let action: () -> Void

    init(_ title: LocalizedStringKey, symbol: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Label {
                Text(title)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                if let symbol { Image(systemName: symbol) }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(KineoPrimaryButtonStyle())
    }
}

struct SecondaryButton: View {
    let title: LocalizedStringKey
    let symbol: String?
    let action: () -> Void

    init(_ title: LocalizedStringKey, symbol: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Label {
                Text(title)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                if let symbol { Image(systemName: symbol) }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(KineoSecondaryButtonStyle())
    }
}

struct OnAccentButton: View {
    let title: LocalizedStringKey
    let symbol: String?
    let action: () -> Void

    init(_ title: LocalizedStringKey, symbol: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Label {
                Text(title)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                if let symbol { Image(systemName: symbol) }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(KineoOnAccentButtonStyle())
    }
}

struct DestructiveButton: View {
    let title: LocalizedStringKey
    let action: () -> Void

    init(_ title: LocalizedStringKey, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(role: .destructive, action: action) {
            Text(title)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(KineoDestructiveButtonStyle())
    }
}

private struct KineoPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Color.white)
            .padding(.horizontal, KineoLayout.standardSpacing)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight)
            .background(configuration.isPressed ? KineoColor.pressedAccent : KineoColor.accent)
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous))
            .shadow(
                color: KineoColor.accent.opacity(isEnabled ? KineoLayout.shadowOpacity : 0),
                radius: KineoLayout.shadowRadius,
                y: KineoLayout.shadowVerticalOffset
            )
            .opacity(isEnabled ? 1 : KineoLayout.disabledOpacity)
            .scaleEffect(configuration.isPressed && !reduceMotion ? KineoLayout.buttonPressedScale : 1)
    }
}

private struct KineoSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(KineoColor.accent)
            .font(.headline)
            .padding(.horizontal, KineoLayout.standardSpacing)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight)
            .background(configuration.isPressed ? KineoColor.subduedSurface : KineoColor.elevatedSurface)
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous)
                    .stroke(KineoColor.separator, lineWidth: KineoLayout.standardBorderWidth)
            }
            .opacity(isEnabled ? 1 : KineoLayout.disabledOpacity)
            .scaleEffect(configuration.isPressed && !reduceMotion ? KineoLayout.buttonPressedScale : 1)
    }
}

private struct KineoOnAccentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(KineoColor.pressedAccent)
            .padding(.horizontal, KineoLayout.standardSpacing)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight)
            .background(
                Color.white.opacity(
                    configuration.isPressed ?
                        KineoLayout.unselectedOpacity : KineoLayout.opaqueColorAlpha
                )
            )
            .clipShape(RoundedRectangle(
                cornerRadius: KineoLayout.controlRadius,
                style: .continuous
            ))
            .opacity(isEnabled ? KineoLayout.opaqueColorAlpha : KineoLayout.disabledOpacity)
            .scaleEffect(
                configuration.isPressed && !reduceMotion ?
                    KineoLayout.buttonPressedScale : KineoLayout.opaqueColorAlpha
            )
    }
}

private struct KineoDestructiveButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Color.red)
            .padding(.horizontal, KineoLayout.standardSpacing)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight)
            .background(Color.red.opacity(configuration.isPressed ? KineoLayout.progressTrackOpacity : KineoLayout.shadowOpacity))
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous)
                    .stroke(Color.red.opacity(KineoLayout.progressTrackOpacity))
            }
            .opacity(isEnabled ? 1 : KineoLayout.disabledOpacity)
    }
}

struct RoutineActionButton: View {
    let title: LocalizedStringKey
    let symbol: String?
    let action: () -> Void

    init(
        title: LocalizedStringKey,
        symbol: String? = nil,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.symbol = symbol
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Label {
                Text(title)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                if let symbol { Image(systemName: symbol) }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(KineoRoutineActionButtonStyle())
    }
}

private struct KineoRoutineActionButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(KineoColor.brandInk)
            .padding(.horizontal, KineoLayout.smallSpacing)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight)
            .background(
                configuration.isPressed ?
                    KineoColor.subduedSurface : KineoColor.elevatedSurface
            )
            .clipShape(RoundedRectangle(
                cornerRadius: KineoLayout.controlRadius,
                style: .continuous
            ))
            .overlay {
                RoundedRectangle(
                    cornerRadius: KineoLayout.controlRadius,
                    style: .continuous
                )
                .stroke(KineoColor.separator, lineWidth: KineoLayout.standardBorderWidth)
            }
            .scaleEffect(
                configuration.isPressed && !reduceMotion ?
                    KineoLayout.buttonPressedScale : KineoLayout.opaqueColorAlpha
            )
    }
}

struct SafetyButton: View {
    let title: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(KineoColor.attentionText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, KineoLayout.standardSpacing)
                .frame(maxWidth: .infinity)
                .frame(minHeight: KineoLayout.minimumPrimaryControlHeight)
                .background(KineoColor.attentionSurface)
                .clipShape(RoundedRectangle(
                    cornerRadius: KineoLayout.controlRadius,
                    style: .continuous
                ))
                .overlay {
                    RoundedRectangle(
                        cornerRadius: KineoLayout.controlRadius,
                        style: .continuous
                    )
                    .stroke(KineoColor.attentionText.opacity(KineoLayout.progressTrackOpacity))
                }
        }
        .buttonStyle(.plain)
    }
}

struct ErrorNotice: View {
    @AccessibilityFocusState private var errorFocused: Bool
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
            Label("Something needs your attention", systemImage: "exclamationmark.circle.fill")
                .font(.headline)
                .foregroundStyle(KineoColor.attentionText)
                .accessibilityHeading(.h2)
            Text(message)
            Button("Retry", action: retry)
                .font(.headline)
                .frame(minHeight: KineoLayout.minimumTouchTarget)
        }
        .padding(KineoLayout.standardSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous))
        .padding(.horizontal, KineoLayout.screenMargin)
        .accessibilityElement(children: .contain)
        .accessibilityFocused($errorFocused)
        .task { errorFocused = true }
    }
}

extension View {
    @ViewBuilder
    func kineoNavigationChrome() -> some View {
        #if os(iOS)
        toolbar(.hidden, for: .navigationBar)
        #else
        self
        #endif
    }

    func cardStyle() -> some View {
        padding(KineoLayout.standardSpacing)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(KineoColor.elevatedSurface)
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.cardRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: KineoLayout.cardRadius, style: .continuous)
                    .stroke(KineoColor.separator, lineWidth: KineoLayout.standardBorderWidth)
            }
            .shadow(
                color: KineoColor.brandInk.opacity(KineoLayout.shadowOpacity),
                radius: KineoLayout.smallSpacing,
                y: KineoLayout.hairlineSpacing
            )
    }

    @ViewBuilder
    func kineoTabChrome() -> some View {
        #if os(iOS)
        toolbarBackground(.visible, for: .tabBar)
            .toolbarBackground(KineoColor.elevatedSurface, for: .tabBar)
        #else
        self
        #endif
    }
}
