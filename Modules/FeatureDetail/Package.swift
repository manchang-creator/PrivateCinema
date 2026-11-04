// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureDetail",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureDetail", targets: ["FeatureDetail"]),
    ],
    targets: [
        .target(
            name: "FeatureDetail",
            dependencies: ["CinemaKit"]
        ),
    ]
)
