// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureDownloads",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureDownloads", targets: ["FeatureDownloads"]),
    ],
    targets: [
        .target(
            name: "FeatureDownloads",
            dependencies: ["CinemaKit"]
        ),
    ]
)
