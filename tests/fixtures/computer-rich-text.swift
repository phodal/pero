import AppKit
import CryptoKit

final class FixtureTextView: NSTextView {
    var pasteCount = 0
    var acceptsPaste = true
    override func paste(_ sender: Any?) {
        pasteCount += 1
        if acceptsPaste { super.paste(sender) }
    }
}

final class RichEditor: NSObject, NSApplicationDelegate, NSTextViewDelegate {
    let output = CommandLine.arguments[1]
    let editor = FixtureTextView(frame: NSRect(x: 24, y: 24, width: 550, height: 320))
    var window: NSWindow!
    var timer: Timer?
    var lastCommand = ""
    var clipboard: [String] = []
    var monitor: Any?
    var keyCode: Int?
    var keyModifiers: UInt?

    func save() {
        let text = editor.string
        let storage = editor.textStorage!
        var bold = ""
        storage.enumerateAttribute(.font, in: NSRange(location: 0, length: storage.length)) { item, range, _ in
            if let font = item as? NSFont, NSFontManager.shared.traits(of: font).contains(.boldFontMask) {
                bold += (text as NSString).substring(with: range)
            }
        }
        let state: [String: Any] = [
            "pid": ProcessInfo.processInfo.processIdentifier, "text": text, "bold": bold,
            "command": lastCommand, "clipboard": clipboard,
            "frontmostPID": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1,
            "keyCode": keyCode ?? -1, "keyModifiers": keyModifiers ?? 0, "pasteCount": editor.pasteCount,
            "readableTypes": editor.readablePasteboardTypes.map { $0.rawValue },
        ]
        if let bytes = try? JSONSerialization.data(withJSONObject: state) {
            try? bytes.write(to: URL(fileURLWithPath: output), options: .atomic)
        }
    }

    func textDidChange(_ notification: Notification) { save() }

    func command() {
        save()
        guard let bytes = try? Data(contentsOf: URL(fileURLWithPath: output + ".command")),
              let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: String],
              let id = value["id"], id != lastCommand else { return }
        if value["action"] == "ignore_paste" {
            editor.acceptsPaste = false
        } else if value["action"] == "clear" {
            editor.string = ""
            editor.setSelectedRange(NSRange(location: 0, length: 0))
        } else if value["action"] == "clipboard" {
            // Fingerprint the real clipboard without placing its text or bytes in test output.
            clipboard = (NSPasteboard.general.pasteboardItems ?? []).map { item in
                item.types.sorted { $0.rawValue < $1.rawValue }.map { type in
                    type.rawValue + ":" + (item.data(forType: type).map { SHA256.hash(data: $0).description } ?? "unavailable")
                }.joined(separator: "|")
            }
        }
        lastCommand = id
        save()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 370),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Pero Rich Editor Fixture"
        window.center()
        editor.isRichText = true
        editor.isAutomaticQuoteSubstitutionEnabled = false
        editor.isAutomaticDashSubstitutionEnabled = false
        editor.font = .systemFont(ofSize: 15)
        editor.delegate = self
        editor.setAccessibilityLabel("Rich editor")
        window.contentView?.addSubview(editor)
        window.makeFirstResponder(editor)
        let menu = NSMenu()
        let appMenu = NSMenuItem()
        appMenu.submenu = NSMenu()
        appMenu.submenu!.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(appMenu)
        let edit = NSMenuItem()
        edit.submenu = NSMenu(title: "Edit")
        edit.submenu!.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menu.addItem(edit)
        NSApp.mainMenu = menu
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.keyCode = Int(event.keyCode)
            self?.keyModifiers = event.modifierFlags.rawValue
            self?.save()
            return event
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.command() }
        save()
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let richEditor = RichEditor()
app.delegate = richEditor
_ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
