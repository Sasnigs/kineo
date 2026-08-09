public enum AppLaunchState: Equatable, Sendable {
    case foundationReady
}

public protocol AppBootstrapping: Sendable {
    func initialState() -> AppLaunchState
}

