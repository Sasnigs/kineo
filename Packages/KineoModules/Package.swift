// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "KineoModules",
    platforms: [
        .iOS(.v17),
        // Host support exists only for module tests; KineoApp remains iPhone-only.
        .macOS(.v14)
    ],
    products: [
        .library(name: "KineoCore", targets: ["KineoCore"]),
        .library(name: "KineoInfrastructure", targets: ["KineoInfrastructure"]),
        .library(name: "KineoUI", targets: ["KineoUI"])
    ],
    targets: [
        .target(
            name: "KineoCore"
        ),
        .target(
            name: "KineoInfrastructure",
            dependencies: ["KineoCore"]
        ),
        .target(
            name: "KineoUI",
            dependencies: ["KineoCore"]
        ),
        .testTarget(
            name: "KineoCoreTests",
            dependencies: ["KineoCore"]
        ),
        .testTarget(
            name: "KineoInfrastructureTests",
            dependencies: ["KineoInfrastructure", "KineoCore"]
        ),
        .testTarget(
            name: "KineoUITests",
            dependencies: ["KineoUI", "KineoCore"]
        ),
        .testTarget(name: "KineoArchitectureTests")
    ],
    swiftLanguageModes: [.v6]
)
