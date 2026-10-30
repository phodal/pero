// An owned AppKit window: independent effects are written by UI callbacks.
import AppKit

final class Canvas: NSView {
    let changed: (String, Int) -> Void
    var summary = ""
    var rectangle = NSRect(x: 30, y: 70, width: 90, height: 60)
    var dragOffset: NSPoint?
    var eventCounts: [String: Int] = [:]
    var hover = 0
    var holdStarted: [String: TimeInterval] = [:]
    var holdDurations: [String: TimeInterval] = [:]
    var tracking: NSTrackingArea?
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking = tracking { removeTrackingArea(tracking) }
        tracking = NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(tracking!)
    }
    override func mouseMoved(with event: NSEvent) { hover += 1; changed("moves", 1) }
    func record(_ event: NSEvent, _ name: String) {
        if name.hasSuffix("Down") { holdStarted[String(name.dropLast(4))] = ProcessInfo.processInfo.systemUptime }
        if name.hasSuffix("Up"), let start = holdStarted[String(name.dropLast(2))] { holdDurations[String(name.dropLast(2))] = ProcessInfo.processInfo.systemUptime - start }
        eventCounts[name] = (eventCounts[name] ?? 0) + 1
        eventCounts[name + "Count"] = event.clickCount
        changed("events", 1)
    }
    init(frame: NSRect, changed: @escaping (String, Int) -> Void) {
        self.changed = changed
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.scrollArea)
        setAccessibilityLabel("Gesture canvas")
    }
    required init?(coder: NSCoder) { fatalError() }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var isFlipped: Bool { true }
    override func draw(_ rect: NSRect) {
        NSColor.windowBackgroundColor.setFill(); rect.fill()
        ("Gesture canvas: click, scroll, drag" as NSString).draw(at: NSPoint(x: 18, y: 18), withAttributes: [.foregroundColor: NSColor.labelColor, .font: NSFont.systemFont(ofSize: 18)])
        NSColor.systemBlue.setFill(); rectangle.fill()
        (summary as NSString).draw(in: NSRect(x: 18, y: 165, width: 510, height: 120), withAttributes: [.foregroundColor: NSColor.labelColor, .font: NSFont.systemFont(ofSize: 16)])
    }
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        let p = convert(event.locationInWindow, from: nil)
        dragOffset = rectangle.contains(p) ? NSPoint(x: p.x - rectangle.minX, y: p.y - rectangle.minY) : nil
        record(event, "leftDown"); changed("clicks", 1)
    }
    override func mouseUp(with event: NSEvent) { dragOffset = nil; record(event, "leftUp") }
    override func rightMouseDown(with event: NSEvent) { record(event, "rightDown") }
    override func rightMouseUp(with event: NSEvent) { record(event, "rightUp") }
    override func otherMouseDown(with event: NSEvent) { record(event, "middleDown") }
    override func otherMouseUp(with event: NSEvent) { record(event, "middleUp") }
    override func mouseDragged(with event: NSEvent) {
        if let offset = dragOffset {
            let p = convert(event.locationInWindow, from: nil)
            rectangle.origin = NSPoint(x: p.x - offset.x, y: p.y - offset.y); needsDisplay = true
        }
        changed("drags", 1)
    }
    override func scrollWheel(with event: NSEvent) { changed("scroll", Int(event.scrollingDeltaY)) }
}

final class Fixture: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    var window: NSWindow!
    var field: NSTextField!
    var canvas: Canvas!
    var count = 0
    var overlay: NSWindow?
    var overlayClicks = 0
    var secureField: NSSecureTextField?
    var timer: Timer?
    var lastCommand = ""
    var selectionObserver: NSObjectProtocol?
    var mouseObserver: Any?
    var activationObserver: NSObjectProtocol?
    var effects: [String: Any] = ["clicks": 0, "drags": 0, "scroll": 0, "count": 0, "text": ""]
    let output = CommandLine.arguments[1]
    func save() {
        if let canvas = canvas {
            effects["rectangle"] = ["x":canvas.rectangle.minX,"y":canvas.rectangle.minY]
            effects["mouseEvents"] = canvas.eventCounts
            effects["hover"] = canvas.hover
            effects["holdDurations"] = canvas.holdDurations
        }
        effects["overlayClicks"] = overlayClicks
        effects["pointer"] = ["x":NSEvent.mouseLocation.x,"y":NSEvent.mouseLocation.y]
        effects["count"] = count; effects["text"] = field?.stringValue ?? ""
        if let canvas = canvas {
            canvas.summary = "Count: \(count)  Text: \(field.stringValue)\nClicks: \(effects["clicks"]!)  Scroll: \(effects["scroll"]!)  Drags: \(effects["drags"]!)"
            canvas.setAccessibilityValue(canvas.summary); canvas.needsDisplay = true
        }
        effects["active"] = NSApp.isActive
        effects["foregroundPID"] = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
        if let window = window {
            effects["windowNumber"] = window.windowNumber
            effects["keyWindow"] = window.isKeyWindow
            effects["frame"] = ["x":window.frame.origin.x,"y":window.frame.origin.y,"width":window.frame.width,"height":window.frame.height]
            if let entries = CGWindowListCopyWindowInfo(.optionIncludingWindow,CGWindowID(window.windowNumber)) as? [[String:Any]], let entry = entries.first {
                effects["cgFrame"] = entry[kCGWindowBounds as String]
            }
        }
        if let range = field?.currentEditor()?.selectedRange {
            effects["selection"] = ["location": range.location, "length": range.length]
        }
        try! JSONSerialization.data(withJSONObject: effects, options: [.sortedKeys]).write(to: URL(fileURLWithPath: output), options: .atomic)
    }
    func command() {
        if let data = try? Data(contentsOf: URL(fileURLWithPath: output + ".command")),
           let command = try? JSONSerialization.jsonObject(with: data) as? [String: String],
           let id = command["id"], id != lastCommand {
            lastCommand = id
            switch command["action"] {
            case "raise": window.makeKeyAndOrderFront(nil)
            case "overlay":
                let cover = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 440), styleMask: [.titled, .closable], backing: .buffered, defer: false)
                cover.title = "Pero Same Process Overlay"
                cover.setFrameOrigin(window.frame.origin)
                let button = NSButton(title: "Overlay", target: self, action: #selector(overlayIncrement))
                button.frame = cover.contentView!.bounds; button.autoresizingMask = [.width, .height]
                cover.contentView!.addSubview(button); cover.makeKeyAndOrderFront(nil); overlay = cover
            case "hide_overlay": overlay?.orderOut(nil)
            case "readonly": field.isEditable = false
            case "editable": field.isEditable = true
            case "disabled": field.isEnabled = false
            case "enabled": field.isEnabled = true
            case "secure":
                secureField = NSSecureTextField(frame: NSRect(x: 170, y: 330, width: 300, height: 32))
                secureField!.setAccessibilityLabel("Fixture password"); secureField!.stringValue = "fixture-secret"; window.contentView!.addSubview(secureField!)
            case "remove_secure": secureField?.removeFromSuperview(); secureField = nil
            case "move": window.setFrameOrigin(NSPoint(x: window.frame.minX + 15, y: window.frame.minY))
            default: break
            }
            effects["command"] = id
        }
        save()
    }
    @objc func overlayIncrement() { overlayClicks += 1; save() }
    @objc func increment() { count += 1; save() }
    func controlTextDidChange(_ notification: Notification) { save() }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 440), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        let guardWindow = CommandLine.arguments.count > 2 && CommandLine.arguments[2] == "guard"
        window.title = guardWindow ? "Pero Computer Guard" : "Pero Computer Fixture"
        // Keep owned test windows visible across Stage Manager sets; no user setting is changed.
        window.appearance = NSAppearance(named: .aqua)
        window.center()
        if guardWindow { window.setFrameOrigin(NSPoint(x: 20, y: 20)) }
        let content = window.contentView!
        content.wantsLayer = true
        let button = NSButton(title: "Increment", target: self, action: #selector(increment))
        button.frame = NSRect(x: 25, y: 370, width: 120, height: 35)
        button.bezelStyle = .rounded
        content.addSubview(button)
        field = NSTextField(frame: NSRect(x: 170, y: 370, width: 400, height: 32))
        field.placeholderString = "Fixture text"; field.setAccessibilityLabel("Fixture text"); field.delegate = self
        content.addSubview(field)
        canvas = Canvas(frame: NSRect(x: 25, y: 30, width: 550, height: 300)) { key, delta in
            self.effects[key] = (self.effects[key] as? Int ?? 0) + delta; self.save()
        }
        content.addSubview(canvas)
        let menu = NSMenu()
        let appMenu = NSMenuItem()
        appMenu.submenu = NSMenu()
        appMenu.submenu!.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(appMenu)
        let editMenu = NSMenuItem()
        editMenu.submenu = NSMenu(title: "Edit")
        editMenu.submenu!.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        menu.addItem(editMenu); NSApp.mainMenu = menu
        selectionObserver = NotificationCenter.default.addObserver(forName: NSTextView.didChangeSelectionNotification, object: nil, queue: .main) { [weak self] _ in self?.save() }
        mouseObserver = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown,.leftMouseDragged,.scrollWheel,.keyDown]) { [weak self] event in
            self?.effects["lastEvent"] = ["window":event.windowNumber,"x":event.locationInWindow.x,"y":event.locationInWindow.y,"type":event.type.rawValue,"key":event.type == .keyDown ? Int(event.keyCode) : -1,"flags":event.modifierFlags.rawValue]
            self?.save(); return event
        }
        activationObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == ProcessInfo.processInfo.processIdentifier { self?.effects["activations"] = (self?.effects["activations"] as? Int ?? 0) + 1 }
            self?.save()
        }
        window.setAccessibilityIdentifier("fixture-window")
        button.setAccessibilityIdentifier("fixture-button")
        field.setAccessibilityIdentifier("fixture-text")
        window.acceptsMouseMovedEvents = true
        if CommandLine.arguments.contains("background") { window.orderFrontRegardless() }
        else { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
        NSAccessibility.post(element: window!, notification: .windowCreated)
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.command() }
        effects["windowRole"] = window.accessibilityRole()?.rawValue ?? "unknown"; effects["pid"] = ProcessInfo.processInfo.processIdentifier; save()
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let fixture = Fixture()
app.delegate = fixture
_ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
