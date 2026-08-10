import KineoCore
import SwiftUI

public struct KineoRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    private let bootstrapper: (any AppBootstrapping)?
    @State private var launchState: AppLaunchState

    public init(launchState: AppLaunchState) {
        bootstrapper = nil
        _launchState = State(initialValue: launchState)
    }

    public init(bootstrapper: any AppBootstrapping) {
        self.bootstrapper = bootstrapper
        _launchState = State(initialValue: .preparingFoundation)
    }

    public var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Kineo", systemImage: "figure.walk")
            } description: {
                Text(message)
            }
            .navigationTitle("Kineo")
        }
        .task(id: scenePhase) {
            guard scenePhase == .active,
                  launchState != .foundationReady,
                  let bootstrapper else { return }
            launchState = await bootstrapper.initialState()
        }
    }

    private var message: String {
        switch launchState {
        case .preparingFoundation:
            "Preparing secure local storage…"
        case .foundationReady:
            "Local foundation is ready."
        case .protectedDataUnavailable:
            "Unlock this iPhone to continue."
        case .foundationUnavailable:
            "Kineo couldn't prepare local storage. Try again after relaunching."
        }
    }
}

#Preview {
    KineoRootView(launchState: .foundationReady)
}
