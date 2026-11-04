// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureSearch",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureSearch", targets: ["FeatureSearch"]),
    ],
    targets: [
        .target(
            name: "FeatureSearch",
            dependencies: ["CinemaKit", "FeatureDetail"]
        ),
    ]
)
