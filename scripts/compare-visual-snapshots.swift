import AppKit
import Foundation

struct RGBAImage {
    let width: Int
    let height: Int
    let pixels: [UInt8]
}

enum SnapshotError: Error, CustomStringConvertible {
    case usage
    case unreadable(String)
    case dimension(String, Int, Int, Int, Int)
    case encode(String)

    var description: String {
        switch self {
        case .usage:
            return "usage: compare-visual-snapshots.swift <baseline-dir> <actual-dir> <diff-dir> [snapshot ...]"
        case let .unreadable(path):
            return "PNGを読み込めません: \(path)"
        case let .dimension(name, expectedWidth, expectedHeight, actualWidth, actualHeight):
            return "\(name) の寸法が異なります: baseline=\(expectedWidth)x\(expectedHeight), actual=\(actualWidth)x\(actualHeight)"
        case let .encode(path):
            return "差分PNGを書き出せません: \(path)"
        }
    }
}

let requiredSnapshots = [
    "native-today.png",
    "native-week.png",
    "native-template-editor.png",
    "native-compact.png",
    "native-conflict.png",
    "native-google-calendar-recovery.png",
    "native-google-calendar-recovery-text-200.png",
]
let channelTolerance = 32
let mismatchRatioTolerance = 0.04

func loadRGBA(_ url: URL) throws -> RGBAImage {
    guard let image = NSImage(contentsOf: url) else {
        throw SnapshotError.unreadable(url.path)
    }
    let width = Int(image.size.width)
    let height = Int(image.size.height)
    guard width > 0, height > 0,
          let representation = NSBitmapImageRep(
              bitmapDataPlanes: nil,
              pixelsWide: width,
              pixelsHigh: height,
              bitsPerSample: 8,
              samplesPerPixel: 4,
              hasAlpha: true,
              isPlanar: false,
              colorSpaceName: .deviceRGB,
              bitmapFormat: [],
              bytesPerRow: width * 4,
              bitsPerPixel: 32
          ), let context = NSGraphicsContext(bitmapImageRep: representation),
          let data = representation.bitmapData
    else {
        throw SnapshotError.unreadable(url.path)
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    image.draw(
        in: NSRect(x: 0, y: 0, width: width, height: height),
        from: .zero,
        operation: .copy,
        fraction: 1
    )
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    return RGBAImage(
        width: width,
        height: height,
        pixels: Array(UnsafeBufferPointer(start: data, count: width * height * 4))
    )
}

func writeDiff(_ pixels: [UInt8], width: Int, height: Int, to url: URL) throws {
    guard let representation = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bitmapFormat: [],
        bytesPerRow: width * 4,
        bitsPerPixel: 32
    ), let target = representation.bitmapData
    else {
        throw SnapshotError.encode(url.path)
    }
    pixels.withUnsafeBytes { source in
        target.update(from: source.bindMemory(to: UInt8.self).baseAddress!, count: pixels.count)
    }
    guard let png = representation.representation(using: .png, properties: [:]) else {
        throw SnapshotError.encode(url.path)
    }
    try png.write(to: url, options: .atomic)
}

func compare(name: String, baselineURL: URL, actualURL: URL, diffURL: URL) throws -> Double {
    let baseline = try loadRGBA(baselineURL)
    let actual = try loadRGBA(actualURL)
    guard baseline.width == actual.width, baseline.height == actual.height else {
        throw SnapshotError.dimension(
            name,
            baseline.width,
            baseline.height,
            actual.width,
            actual.height
        )
    }
    var mismatched = 0
    var diff = actual.pixels
    let pixelCount = baseline.width * baseline.height
    for pixel in 0..<pixelCount {
        let offset = pixel * 4
        let differs = (0..<3).contains { channel in
            abs(Int(baseline.pixels[offset + channel]) - Int(actual.pixels[offset + channel]))
                > channelTolerance
        }
        if differs {
            mismatched += 1
            diff[offset] = 255
            diff[offset + 1] = 32
            diff[offset + 2] = 64
            diff[offset + 3] = 255
        } else {
            for channel in 0..<3 {
                diff[offset + channel] = UInt8(Int(actual.pixels[offset + channel]) / 4)
            }
            diff[offset + 3] = 255
        }
    }
    try writeDiff(diff, width: actual.width, height: actual.height, to: diffURL)
    return Double(mismatched) / Double(pixelCount)
}

do {
    guard CommandLine.arguments.count >= 4 else { throw SnapshotError.usage }
    let baselineDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let actualDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
    let diffDirectory = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
    let requestedSnapshots = Array(CommandLine.arguments.dropFirst(4))
    let snapshots = requestedSnapshots.isEmpty ? requiredSnapshots : requestedSnapshots
    try FileManager.default.createDirectory(
        at: diffDirectory,
        withIntermediateDirectories: true
    )

    var failed = false
    for name in snapshots {
        let ratio = try compare(
            name: name,
            baselineURL: baselineDirectory.appendingPathComponent(name),
            actualURL: actualDirectory.appendingPathComponent(name),
            diffURL: diffDirectory.appendingPathComponent(name)
        )
        let percent = ratio * 100
        print(String(format: "%@: mismatch %.3f%% (limit %.3f%%)", name, percent, mismatchRatioTolerance * 100))
        if ratio > mismatchRatioTolerance { failed = true }
    }
    if failed {
        fputs("視覚差分が許容差を超えました。diff artifactをレビューしてください。\n", stderr)
        exit(1)
    }
} catch {
    fputs("visual snapshot error: \(error)\n", stderr)
    exit(1)
}
