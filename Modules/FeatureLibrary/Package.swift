// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureLibrary",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureLibrary", targets: ["FeatureLibrary"]),
    ],
    targets: [
        .target(
            name: "FeatureLibrary",
            dependencies: ["CinemaKit", "FeatureDetail"]
        ),
    ]
)
