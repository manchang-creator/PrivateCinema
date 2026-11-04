// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureSources",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureSources", targets: ["FeatureSources"]),
    ],
    targets: [
        .target(
            name: "FeatureSources",
            dependencies: ["CinemaKit"]
        ),
    ]
)
