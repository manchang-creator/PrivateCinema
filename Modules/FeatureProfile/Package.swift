// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureProfile",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureProfile", targets: ["FeatureProfile"]),
    ],
    dependencies: [
        .package(path: "../CinemaKit"),
        .package(path: "../FeatureDetail"),
        .package(path: "../FeatureDownloads"),
        .package(path: "../FeatureFavorites"),
        .package(path: "../FeatureHistory"),
        .package(path: "../FeatureSettings"),
        .package(path: "../FeatureSources"),
    ],
    targets: [
        .target(
            name: "FeatureProfile",
            dependencies: [
                .product(name: "CinemaKit", package: "CinemaKit"),
                .product(name: "FeatureDetail", package: "FeatureDetail"),
                .product(name: "FeatureDownloads", package: "FeatureDownloads"),
                .product(name: "FeatureFavorites", package: "FeatureFavorites"),
                .product(name: "FeatureHistory", package: "FeatureHistory"),
                .product(name: "FeatureSettings", package: "FeatureSettings"),
                .product(name: "FeatureSources", package: "FeatureSources"),
            ]
        ),
    ]
)
