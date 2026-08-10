public enum AppLaunchState: Equatable, Sendable {
    case preparingFoundation
    case foundationReady
    case protectedDataUnavailable
    case foundationUnavailable
}

public protocol AppBootstrapping: Sendable {
    func initialState() async -> AppLaunchState
}
