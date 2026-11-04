import ProjectDescription

// ==================== 本地模块包 ====================
// 每个 Feature 一个本地 SPM 包，CinemaKit 为共享内核。
// 包内依赖已在各自 Package.swift 声明，Tuist 只需登记路径。

let modules: [String] = [
    "CinemaKit",
    "FeatureDetail",
    "FeatureDownloads",
    "FeatureFavorites",
    "FeatureHistory",
    "FeatureHome",
    "FeatureLibrary",
    "FeatureProfile",
    "FeatureSearch",
    "FeatureSettings",
    "FeatureSources",
]

let localPackages: [Package] = modules.map { .local(path: "Modules/\($0)") }

// App 直接引用的包：Tab 页 + 播放器所在的内核
let appPackageProducts: [TargetDependency] = [
    .package(product: "CinemaKit"),
    .package(product: "FeatureHome"),
    .package(product: "FeatureSearch"),
    .package(product: "FeatureLibrary"),
    .package(product: "FeatureProfile"),
]

// 单测覆盖内核模块（解析器 / 弹幕 / 下载 / 首页模块映射）
let unitTestPackageProducts: [TargetDependency] = [
    .package(product: "CinemaKit"),
]

// ==================== 工程 ====================

let project = Project(
    name: "PrivateCinema",
    organizationName: "PrivateCinema",
    options: .options(
        automaticSchemesOptions: .disabled
    ),
    packages: localPackages,
    settings: .settings(
        base: [
            "SWIFT_VERSION": "5.0",
            "DEVELOPMENT_TEAM": "",
        ]
    ),
    targets: [
        .target(
            name: "PrivateCinema",
            destinations: .iOS,
            product: .app,
            bundleId: "com.private.cinema",
            deploymentTargets: .iOS("17.0"),
            infoPlist: .file(path: "apps/PrivateCinema/Info.plist"),
            sources: ["apps/PrivateCinema/Sources/**"],
            resources: ["apps/PrivateCinema/Resources/**"],
            dependencies: appPackageProducts,
            settings: .settings(
                base: [
                    "TARGETED_DEVICE_FAMILY": "1,2",
                    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
                    "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
                    "MARKETING_VERSION": "1.0",
                    "CURRENT_PROJECT_VERSION": "1",
                ]
            )
        ),
        .target(
            name: "PrivateCinemaTests",
            destinations: .iOS,
            product: .unitTests,
            bundleId: "com.private.cinema.tests",
            deploymentTargets: .iOS("17.0"),
            infoPlist: .default,
            sources: ["Tests/PrivateCinemaTests/**"],
            dependencies: [
                .target(name: "PrivateCinema"),
            ] + unitTestPackageProducts,
            settings: .settings(
                base: [
                    // 单测以 @testable 访问 CinemaKit 内部符号，需开启可测试性
                    "ENABLE_TESTABILITY": "YES",
                ]
            )
        ),
        .target(
            name: "PrivateCinemaUITests",
            destinations: .iOS,
            product: .uiTests,
            bundleId: "com.private.cinema.uitests",
            deploymentTargets: .iOS("17.0"),
            infoPlist: .default,
            sources: ["Tests/PrivateCinemaUITests/**"],
            dependencies: [
                .target(name: "PrivateCinema"),
            ]
        ),
    ],
    schemes: [
        .scheme(
            name: "PrivateCinema",
            shared: true,
            buildAction: .buildAction(
                targets: [
                    .target("PrivateCinema"),
                    .target("PrivateCinemaTests", buildFor: [.testing]),
                    .target("PrivateCinemaUITests", buildFor: [.testing]),
                ]
            ),
            testAction: .targets(["PrivateCinemaTests", "PrivateCinemaUITests"]),
            runAction: .runAction(executable: "PrivateCinema")
        ),
    ]
)
