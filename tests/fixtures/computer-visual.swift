// The tile labels, highlighted position and confirmation are pixels only.
import AppKit

struct Challenge: Decodable {
    let codes: [String]
    let target: Int
    let confirmation: String
}

final class VisualTiles: NSView {
    let challenge: Challenge
    let record: (String) -> Void
    var selected: Int?

    init(frame: NSRect, challenge: Challenge, record: @escaping (String) -> Void) {
        self.challenge = challenge
        self.record = record
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Visual challenge")
    }

    required init?(coder: NSCoder) { fatalError() }
    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    func tile(_ index: Int) -> NSRect {
        NSRect(x: 32 + CGFloat(index) * 250, y: 145, width: 220, height: 130)
    }

    func drawCentered(_ text: String, in frame: NSRect, size: CGFloat) {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        (text as NSString).draw(in: frame, withAttributes: [
            .paragraphStyle: style,
            .foregroundColor: NSColor.white,
            .font: NSFont.monospacedSystemFont(ofSize: size, weight: .bold),
        ])
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(srgbRed: 0.07, green: 0.11, blue: 0.18, alpha: 1).setFill()
        dirtyRect.fill()
        drawCentered("Select the outlined tile", in: NSRect(x: 0, y: 52, width: bounds.width, height: 48), size: 32)
        for (index, code) in challenge.codes.enumerated() {
            let frame = tile(index)
            let shape = NSBezierPath(roundedRect: frame, xRadius: 14, yRadius: 14)
            NSColor(srgbRed: 0.17, green: 0.25, blue: 0.37, alpha: 1).setFill()
            shape.fill()
            if index == challenge.target {
                NSColor(srgbRed: 1, green: 0.82, blue: 0.29, alpha: 1).setStroke()
                shape.lineWidth = 7
                shape.stroke()
            }
            drawCentered(code, in: frame.offsetBy(dx: 0, dy: 40), size: 40)
        }
        if let selected {
            let result = selected == challenge.target ? "Confirmation: \(challenge.confirmation)" : "Wrong tile"
            drawCentered(result, in: NSRect(x: 0, y: 317, width: bounds.width, height: 48), size: 32)
        }
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard let index = challenge.codes.indices.first(where: { tile($0).contains(point) }) else { return }
        selected = index
        record(challenge.codes[index])
        needsDisplay = true
        displayIfNeeded()
    }
}

final class VisualFixture: NSObject, NSApplicationDelegate {
    let output = URL(fileURLWithPath: CommandLine.arguments[1])
    var window: NSWindow?
    var selections: [String] = []

    func record() {
        let state: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier, "selections": selections]
        try! JSONSerialization.data(withJSONObject: state).write(to: output, options: .atomic)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = URL(fileURLWithPath: CommandLine.arguments[2])
        let challenge = try! JSONDecoder().decode(Challenge.self, from: Data(contentsOf: config))
        let frame = NSRect(x: 0, y: 0, width: 786, height: 390)
        let window = NSWindow(contentRect: frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Pero Visual Fixture"
        window.contentView = VisualTiles(frame: frame, challenge: challenge) { [weak self] code in
            self?.selections.append(code)
            self?.record()
        }
        self.window = window
        window.center()
        window.orderFrontRegardless()
        NSAccessibility.post(element: window, notification: .windowCreated)
        record()
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let fixture = VisualFixture()
app.delegate = fixture
_ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
