import AppKit
import CoreGraphics
import Darwin
import Foundation

private let minimumVisibleWidth = 1_200
private let minimumVisibleHeight = 900
private let minimumModeHeight = 1_024

private func fail(_ message: String, status: Int32 = 2) -> Never {
    fputs("::error::\(message)\n", stderr)
    exit(status)
}

@MainActor
private func primaryScreen(for displayID: CGDirectDisplayID) -> NSScreen? {
    NSScreen.screens.first { screen in
        guard
            let number = screen.deviceDescription[
                NSDeviceDescriptionKey("NSScreenNumber")
            ] as? NSNumber
        else {
            return false
        }
        return number.uint32Value == displayID
    }
}

@MainActor
private func availableArea(for displayID: CGDirectDisplayID) -> (width: Int, height: Int)? {
    guard let screen = primaryScreen(for: displayID) else { return nil }
    let frame = screen.visibleFrame
    return (Int(frame.width.rounded()), Int(frame.height.rounded()))
}

private func sameGeometry(_ lhs: CGDisplayMode, _ rhs: CGDisplayMode) -> Bool {
    lhs.width == rhs.width
        && lhs.height == rhs.height
        && lhs.pixelWidth == rhs.pixelWidth
        && lhs.pixelHeight == rhs.pixelHeight
}

@MainActor
private func ensureNativeE2EDisplay() -> CGDisplayMode {
    let displayID = CGMainDisplayID()
    guard
        let screen = primaryScreen(for: displayID),
        let currentMode = CGDisplayCopyDisplayMode(displayID),
        let rawModes = CGDisplayCopyAllDisplayModes(displayID, nil) as? [CGDisplayMode]
    else {
        fail("Unable to inspect the primary macOS display; native E2E was not started.")
    }

    let originalScale = screen.backingScaleFactor
    let usableModes = rawModes
        .filter { $0.isUsableForDesktopGUI() }
        .sorted {
            let leftArea = $0.width * $0.height
            let rightArea = $1.width * $1.height
            if leftArea != rightArea { return leftArea < rightArea }
            return $0.refreshRate > $1.refreshRate
        }

    let currentArea = availableArea(for: displayID) ?? (width: 0, height: 0)
    let currentModeIsAvailable = usableModes.contains { sameGeometry($0, currentMode) }
    let currentModeKeepsScale =
        currentMode.width > 0
        && abs(Double(currentMode.pixelWidth) / Double(currentMode.width) - Double(originalScale))
            < 0.01
    if
        currentModeIsAvailable,
        currentModeKeepsScale,
        currentArea.width >= minimumVisibleWidth,
        currentArea.height >= minimumVisibleHeight
    {
        return currentMode
    }

    var seenGeometry = Set<String>()
    let candidates = usableModes
        .filter { $0.width >= minimumVisibleWidth && $0.height >= minimumModeHeight }
        .filter {
            $0.width > 0
                && abs(Double($0.pixelWidth) / Double($0.width) - Double(originalScale)) < 0.01
        }
        .filter { !sameGeometry($0, currentMode) }
        .filter { mode in
            let key = "\(mode.width)x\(mode.height)-\(mode.pixelWidth)x\(mode.pixelHeight)"
            return seenGeometry.insert(key).inserted
        }

    var largestObserved = currentArea
    for mode in candidates {
        guard CGDisplaySetDisplayMode(displayID, mode, nil) == .success else { continue }

        let deadline = Date().addingTimeInterval(5)
        repeat {
            if
                let activeScreen = primaryScreen(for: displayID),
                let area = availableArea(for: displayID)
            {
                if area.width * area.height > largestObserved.width * largestObserved.height {
                    largestObserved = area
                }
                if
                    area.width >= minimumVisibleWidth,
                    area.height >= minimumVisibleHeight,
                    abs(Double(activeScreen.backingScaleFactor) - Double(originalScale)) < 0.01
                {
                    return mode
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
    }

    fail(
        "No supported macOS display mode provided a \(minimumVisibleWidth)x\(minimumVisibleHeight) logical-point work area at the existing screen scale; largest observed area was \(largestObserved.width)x\(largestObserved.height). Native E2E was not started."
    )
}

@MainActor
private func run() -> Never {
    // NSScreen needs an application object to connect to the window system.
    let _ = NSApplication.shared

    let separator = CommandLine.arguments.firstIndex(of: "--")
    guard
        let separator,
        separator + 1 < CommandLine.arguments.count
    else {
        fail("A native E2E command is required after --.")
    }

    let mode = ensureNativeE2EDisplay()
    let area = availableArea(for: CGMainDisplayID()) ?? (width: 0, height: 0)
    print(
        "Native E2E display ready: mode \(mode.width)x\(mode.height), visible work area \(area.width)x\(area.height) logical points."
    )

    let child = Process()
    child.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    child.arguments = Array(CommandLine.arguments[(separator + 1)...])
    child.currentDirectoryURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    child.standardInput = FileHandle.standardInput
    child.standardOutput = FileHandle.standardOutput
    child.standardError = FileHandle.standardError

    do {
        try child.run()
        child.waitUntilExit()
        // Keep the selected display mode for the child, then let macOS restore it
        // automatically when this process exits.
        exit(child.terminationStatus)
    } catch {
        fail("Unable to start the native E2E command.", status: 70)
    }
}

MainActor.assumeIsolated { run() }
