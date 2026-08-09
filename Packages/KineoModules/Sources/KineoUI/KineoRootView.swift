import KineoCore
import SwiftUI

public struct KineoRootView: View {
    private let launchState: AppLaunchState

    public init(launchState: AppLaunchState) {
        self.launchState = launchState
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
    }

    private var message: String {
        switch launchState {
        case .foundationReady:
            "Project foundation is ready."
        }
    }
}

#Preview {
    KineoRootView(launchState: .foundationReady)
}

