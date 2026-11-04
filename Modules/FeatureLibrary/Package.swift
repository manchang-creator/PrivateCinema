// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FeatureLibrary",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FeatureLibrary", targets: ["FeatureLibrary"]),
    ],
    dependencies: [
        .package(path: "../CinemaKit"),
        .package(path: "../FeatureDetail"),
    ],
    targets: [
        .target(
            name: "FeatureLibrary",
            dependencies: [
                .product(name: "CinemaKit", package: "CinemaKit"),
                .product(name: "FeatureDetail", package: "FeatureDetail"),
            ]
        ),
    ]
)
