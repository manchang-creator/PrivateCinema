// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureHistory",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureHistory", targets: ["FeatureHistory"]),
    ],
    targets: [
        .target(
            name: "FeatureHistory",
            dependencies: ["CinemaKit"]
        ),
    ]
)
