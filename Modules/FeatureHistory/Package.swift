// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureHistory",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureHistory", targets: ["FeatureHistory"]),
    ],
    dependencies: [
        .package(path: "../CinemaKit"),
    ],
    targets: [
        .target(
            name: "FeatureHistory",
            dependencies: [
                .product(name: "CinemaKit", package: "CinemaKit"),
            ]
        ),
    ]
)
