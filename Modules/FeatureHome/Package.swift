// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureHome",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureHome", targets: ["FeatureHome"]),
    ],
    dependencies: [
        .package(path: "../CinemaKit"),
        .package(path: "../FeatureDetail"),
        .package(path: "../FeatureSearch"),
    ],
    targets: [
        .target(
            name: "FeatureHome",
            dependencies: [
                .product(name: "CinemaKit", package: "CinemaKit"),
                .product(name: "FeatureDetail", package: "FeatureDetail"),
                .product(name: "FeatureSearch", package: "FeatureSearch"),
            ]
        ),
    ]
)
