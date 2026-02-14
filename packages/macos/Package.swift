// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "MCPMaker",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "MCPMaker", targets: ["MCPMaker"])
    ],
    targets: [
        .executableTarget(
            name: "MCPMaker",
            resources: [
                .copy("../../Resources/content-script.js"),
                .copy("../../Resources/Assets.xcassets")
            ],
            swiftSettings: [
                .unsafeFlags(["-enable-bare-slash-regex"])
            ]
        ),
        .testTarget(
            name: "MCPMakerTests",
            dependencies: ["MCPMaker"],
            path: "Tests/MCPMakerTests"
        )
    ]
)
