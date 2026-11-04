// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureSettings",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureSettings", targets: ["FeatureSettings"]),
    ],
    targets: [
        .target(
            name: "FeatureSettings",
            dependencies: ["CinemaKit"]
        ),
    ]
)
