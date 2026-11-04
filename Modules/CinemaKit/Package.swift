// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CinemaKit",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "CinemaKit", targets: ["CinemaKit"]),
    ],
    targets: [
        .target(
            name: "CinemaKit"
        ),
    ]
)
