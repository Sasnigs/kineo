import KineoCore

public struct PrototypeBootstrapper: AppBootstrapping {
    public init() {}

    public func initialState() -> AppLaunchState {
        .foundationReady
    }
}

