// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureProfile",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureProfile", targets: ["FeatureProfile"]),
    ],
    targets: [
        .target(
            name: "FeatureProfile",
            dependencies: ["CinemaKit", "FeatureDetail", "FeatureDownloads", "FeatureFavorites", "FeatureHistory", "FeatureSettings", "FeatureSources"]
        ),
    ]
)
