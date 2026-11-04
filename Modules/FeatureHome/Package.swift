// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureHome",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureHome", targets: ["FeatureHome"]),
    ],
    targets: [
        .target(
            name: "FeatureHome",
            dependencies: ["CinemaKit", "FeatureDetail", "FeatureSearch"]
        ),
    ]
)
