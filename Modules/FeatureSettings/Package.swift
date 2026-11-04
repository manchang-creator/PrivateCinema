// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureSettings",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureSettings", targets: ["FeatureSettings"]),
    ],
    dependencies: [
        .package(path: "../CinemaKit"),
    ],
    targets: [
        .target(
            name: "FeatureSettings",
            dependencies: [
                .product(name: "CinemaKit", package: "CinemaKit"),
            ]
        ),
    ]
)
