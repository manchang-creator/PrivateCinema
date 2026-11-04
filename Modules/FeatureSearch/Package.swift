// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureSearch",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureSearch", targets: ["FeatureSearch"]),
    ],
    dependencies: [
        .package(path: "../CinemaKit"),
        .package(path: "../FeatureDetail"),
    ],
    targets: [
        .target(
            name: "FeatureSearch",
            dependencies: [
                .product(name: "CinemaKit", package: "CinemaKit"),
                .product(name: "FeatureDetail", package: "FeatureDetail"),
            ]
        ),
    ]
)
