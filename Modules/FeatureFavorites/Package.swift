// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureFavorites",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureFavorites", targets: ["FeatureFavorites"]),
    ],
    targets: [
        .target(
            name: "FeatureFavorites",
            dependencies: ["CinemaKit", "FeatureDetail"]
        ),
    ]
)
