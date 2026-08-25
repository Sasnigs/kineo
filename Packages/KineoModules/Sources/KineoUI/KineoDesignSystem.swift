import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

enum KineoColor {
    static let accent = Color(red: 0.17, green: 0.40, blue: 0.36)
    static let pressedAccent = Color(red: 0.12, green: 0.31, blue: 0.28)
    static let accentSurface = adaptiveColor(
        light: (0.91, 0.96, 0.94),
        dark: (0.10, 0.20, 0.18)
    )
    static let canvas = adaptiveColor(
        light: (0.97, 0.97, 0.94),
        dark: (0.06, 0.07, 0.07)
    )
    static let elevatedSurface = adaptiveColor(
        light: (1.00, 1.00, 0.99),
        dark: (0.11, 0.12, 0.12)
    )
    static let subduedSurface = adaptiveColor(
        light: (0.94, 0.94, 0.91),
        dark: (0.15, 0.16, 0.16)
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
    static let heroMarkSize: CGFloat = 112
    static let decorativePathWidth: CGFloat = 180
    static let decorativePathHeight: CGFloat = 150
    static let controlRadius: CGFloat = 16
    static let cardRadius: CGFloat = 24
    static let heroRadius: CGFloat = 30
    static let standardBorderWidth: CGFloat = 1
    static let selectedBorderWidth: CGFloat = 2
    static let buttonPressedScale = 0.98
    static let disabledOpacity = 0.45
    static let unselectedOpacity = 0.72
    static let separatorOpacity = 0.12
    static let shadowOpacity = 0.07
    static let shadowRadius: CGFloat = 18
    static let shadowVerticalOffset: CGFloat = 8
    static let decorativeOpacity = 0.12
    static let progressTrackOpacity = 0.14
    static let opaqueColorAlpha = 1.0
    static let regularMetricColumnCount = 2
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
        ZStack(alignment: .topTrailing) {
            KineoColor.canvas.ignoresSafeArea()
            KineoMovementPath()
                .stroke(KineoColor.accent.opacity(KineoLayout.decorativeOpacity), lineWidth: KineoLayout.selectedBorderWidth)
                .frame(width: KineoLayout.decorativePathWidth, height: KineoLayout.decorativePathHeight)
                .offset(x: KineoLayout.sectionSpacing, y: -KineoLayout.sectionSpacing)
                .accessibilityHidden(true)

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
        VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
            if let eyebrow {
                Text(eyebrow)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(KineoColor.accent)
                    .textCase(.uppercase)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .firstTextBaseline, spacing: KineoLayout.smallSpacing) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(KineoColor.accent)
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(.largeTitle.bold())
                    .accessibilityHeading(.h1)
                    .accessibilityFocused($titleFocused)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
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

struct KineoHeroMark: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(KineoColor.accentSurface)
            KineoMovementPath()
                .stroke(KineoColor.accent, style: StrokeStyle(lineWidth: KineoLayout.selectedBorderWidth, lineCap: .round))
                .padding(KineoLayout.sectionSpacing)
            Image(systemName: "figure.flexibility")
                .font(.system(size: KineoLayout.heroSymbolPointSize, weight: .medium))
                .foregroundStyle(KineoColor.accent)
        }
        .frame(width: KineoLayout.heroMarkSize, height: KineoLayout.heroMarkSize)
        .accessibilityHidden(true)
    }
}

struct SectionHeader: View {
    let title: LocalizedStringKey
    var detail: LocalizedStringKey?

    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.hairlineSpacing) {
            Text(title)
                .font(.title2.weight(.semibold))
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
                        .foregroundStyle(selected ? Color.white : KineoColor.accent)
                        .frame(width: KineoLayout.choiceSymbolSize, height: KineoLayout.choiceSymbolSize)
                        .background(selected ? KineoColor.accent : KineoColor.accentSurface, in: Circle())
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
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(selected ? KineoColor.accent : Color.secondary)
                    .accessibilityHidden(true)
            }
            .padding(KineoLayout.standardSpacing)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight, alignment: .leading)
            .background(selected ? KineoColor.accentSurface : KineoColor.elevatedSurface)
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous)
                    .stroke(
                        selected ? KineoColor.accent : KineoColor.separator,
                        lineWidth: borderWidth
                    )
            }
        }
        .buttonStyle(KineoChoiceButtonStyle())
        .accessibilityLabel(Text(title))
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
            .padding(.horizontal, KineoLayout.standardSpacing)
            .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight)
            .background(configuration.isPressed ? KineoColor.subduedSurface : KineoColor.accentSurface)
            .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous)
                    .stroke(KineoColor.accent.opacity(KineoLayout.progressTrackOpacity))
            }
            .opacity(isEnabled ? 1 : KineoLayout.disabledOpacity)
            .scaleEffect(configuration.isPressed && !reduceMotion ? KineoLayout.buttonPressedScale : 1)
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

struct MetricTile: View {
    let value: String
    let label: LocalizedStringKey
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.compactSpacing) {
            Image(systemName: symbol)
                .font(.headline)
                .foregroundStyle(KineoColor.accent)
                .accessibilityHidden(true)
            Text(value)
                .font(.title2.weight(.bold))
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(KineoLayout.standardSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KineoColor.elevatedSurface)
        .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous)
                .stroke(KineoColor.separator)
        }
        .accessibilityElement(children: .combine)
    }
}

struct RoutineActionButton: View {
    let title: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight)
        .buttonStyle(.bordered)
        .controlSize(.large)
    }
}

struct SafetyButton: View {
    let title: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: "exclamationmark.triangle.fill")
                .font(.headline)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity)
        }
        .foregroundStyle(KineoColor.attentionText)
        .padding(.horizontal, KineoLayout.standardSpacing)
        .frame(maxWidth: .infinity, minHeight: KineoLayout.minimumPrimaryControlHeight)
        .background(KineoColor.attentionSurface)
        .clipShape(RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: KineoLayout.controlRadius, style: .continuous)
                .stroke(KineoColor.attentionText.opacity(KineoLayout.progressTrackOpacity))
        }
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
                    .stroke(KineoColor.separator)
            }
            .shadow(
                color: Color.black.opacity(KineoLayout.shadowOpacity),
                radius: KineoLayout.shadowRadius,
                y: KineoLayout.shadowVerticalOffset
            )
    }
}
