import Foundation
import SwiftUI
#if canImport(AVFoundation) && canImport(UIKit)
import AVFoundation
import UIKit
#endif

enum PrototypeExerciseVideoAssetError: Error, Equatable {
    case resourceMissing
}

enum PrototypeExerciseVideoAsset {
    static let resourceName = "prototype-side-reach"
    static let resourceExtension = "mp4"

    static func url(
        in bundle: Bundle = .module
    ) throws(PrototypeExerciseVideoAssetError) -> URL {
        guard let url = bundle.url(
            forResource: resourceName,
            withExtension: resourceExtension
        ) else {
            throw .resourceMissing
        }
        return url
    }
}

struct PrototypeExerciseVideoPreview: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isPreviewPaused = false
    @State private var didRequestReducedMotionPlayback = false

    let isRoutinePaused: Bool
    private let assetState: PrototypeExerciseVideoAssetState

    init(isRoutinePaused: Bool) {
        self.isRoutinePaused = isRoutinePaused
        do {
            assetState = .available(try PrototypeExerciseVideoAsset.url())
        } catch {
            assetState = .unavailable
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: KineoLayout.smallSpacing) {
            ZStack(alignment: .topLeading) {
                videoSurface
                Label("Prototype video", systemImage: "hammer.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(KineoColor.brandInk)
                    .padding(.horizontal, KineoLayout.smallSpacing)
                    .frame(minHeight: KineoLayout.minimumTouchTarget)
                    .background(.regularMaterial, in: Capsule())
                    .padding(KineoLayout.standardSpacing)
                    .accessibilityHidden(true)
                if case .available = assetState {
                    playbackButton
                        .frame(
                            maxWidth: .infinity,
                            maxHeight: .infinity,
                            alignment: .bottomTrailing
                        )
                        .padding(KineoLayout.standardSpacing)
                }
            }
            .frame(maxWidth: .infinity, minHeight: KineoLayout.routineMediaHeight)
            .clipShape(RoundedRectangle(
                cornerRadius: KineoLayout.controlRadius,
                style: .continuous
            ))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Prototype exercise video preview")
            .accessibilityValue(
                "Synthetic internal mock. Written instructions and routine controls remain available."
            )
            .accessibilityIdentifier("Prototype movement preview")

            Text("Synthetic test footage only. Licensed, reviewed demonstrations will replace it before release.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var videoSurface: some View {
        switch assetState {
        case .available(let url):
            #if canImport(AVFoundation) && canImport(UIKit)
            PrototypeLoopingVideoPlayer(
                url: url,
                isPlaying: shouldPlay
            )
            .accessibilityHidden(true)
            #else
            prototypePoster
            #endif
        case .unavailable:
            prototypePoster
                .overlay(alignment: .bottomLeading) {
                    Label("Video preview unavailable", systemImage: "video.slash")
                        .font(.caption.weight(.semibold))
                        .padding(KineoLayout.standardSpacing)
                }
        }
    }

    private var prototypePoster: some View {
        ZStack {
            KineoColor.spotlightGradient
            Image("KineoHeroFigure", bundle: .module)
                .resizable()
                .scaledToFit()
                .padding(.top, KineoLayout.smallSpacing)
        }
        .accessibilityHidden(true)
    }

    private var playbackButton: some View {
        Button {
            if reduceMotion && didRequestReducedMotionPlayback == false {
                didRequestReducedMotionPlayback = true
                isPreviewPaused = false
            } else {
                isPreviewPaused.toggle()
            }
        } label: {
            Image(systemName: shouldPlay ? "pause.fill" : "play.fill")
                .font(.headline)
                .foregroundStyle(KineoColor.brandInk)
                .frame(
                    width: KineoLayout.minimumTouchTarget,
                    height: KineoLayout.minimumTouchTarget
                )
                .background(.regularMaterial, in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(isRoutinePaused)
        .accessibilityLabel(playbackButtonLabel)
    }

    private var shouldPlay: Bool {
        PrototypeExerciseVideoPlaybackPolicy.shouldPlay(
            isRoutinePaused: isRoutinePaused,
            isPreviewPaused: isPreviewPaused,
            reduceMotion: reduceMotion,
            didRequestReducedMotionPlayback: didRequestReducedMotionPlayback
        )
    }

    private var playbackButtonLabel: String {
        if isRoutinePaused {
            return "Video paused with routine"
        }
        return shouldPlay ? "Pause prototype video" : "Play prototype video"
    }
}

enum PrototypeExerciseVideoPlaybackPolicy {
    static func shouldPlay(
        isRoutinePaused: Bool,
        isPreviewPaused: Bool,
        reduceMotion: Bool,
        didRequestReducedMotionPlayback: Bool
    ) -> Bool {
        isRoutinePaused == false &&
            isPreviewPaused == false &&
            (reduceMotion == false || didRequestReducedMotionPlayback)
    }
}

private enum PrototypeExerciseVideoAssetState {
    case available(URL)
    case unavailable
}

#if canImport(AVFoundation) && canImport(UIKit)
@MainActor
private struct PrototypeLoopingVideoPlayer: UIViewRepresentable {
    let url: URL
    let isPlaying: Bool

    func makeUIView(context: Context) -> PrototypeVideoPlayerView {
        let view = PrototypeVideoPlayerView()
        view.load(url: url)
        view.setPlaying(isPlaying)
        return view
    }

    func updateUIView(_ view: PrototypeVideoPlayerView, context: Context) {
        view.setPlaying(isPlaying)
    }

    static func dismantleUIView(_ view: PrototypeVideoPlayerView, coordinator: Void) {
        view.stop()
    }
}

@MainActor
private final class PrototypeVideoPlayerView: UIView {
    private let player = AVQueuePlayer()
    private var looper: AVPlayerLooper?

    override class var layerClass: AnyClass {
        AVPlayerLayer.self
    }

    private var playerLayer: AVPlayerLayer {
        guard let layer = layer as? AVPlayerLayer else {
            preconditionFailure("PrototypeVideoPlayerView must use AVPlayerLayer")
        }
        return layer
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        player.isMuted = true
        playerLayer.player = player
        playerLayer.videoGravity = .resizeAspectFill
        backgroundColor = .clear
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    func load(url: URL) {
        player.removeAllItems()
        looper = AVPlayerLooper(
            player: player,
            templateItem: AVPlayerItem(url: url)
        )
    }

    func setPlaying(_ isPlaying: Bool) {
        if isPlaying {
            player.play()
        } else {
            player.pause()
        }
    }

    func stop() {
        player.pause()
        looper?.disableLooping()
        looper = nil
        player.removeAllItems()
    }
}
#endif
