// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureFavorites",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureFavorites", targets: ["FeatureFavorites"]),
    ],
    dependencies: [
        .package(path: "../CinemaKit"),
        .package(path: "../FeatureDetail"),
    ],
    targets: [
        .target(
            name: "FeatureFavorites",
            dependencies: [
                .product(name: "CinemaKit", package: "CinemaKit"),
                .product(name: "FeatureDetail", package: "FeatureDetail"),
            ]
        ),
    ]
)
