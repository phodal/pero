// A real SwiftUI content tree hosted in an owned AppKit window.
import AppKit
import SwiftUI

final class Model: ObservableObject {
    @Published var count = 0
    @Published var text = ""
}
struct Content: View {
    @ObservedObject var model: Model
    var body: some View {
        VStack(spacing: 20) {
            Button("Framework increment") { model.count += 1 }
            TextField("Framework text", text: $model.text).accessibilityLabel("Framework text")
            Text("Count: \(model.count)")
        }.padding(24).frame(width: 500, height: 240)
    }
}
final class Fixture: NSObject, NSApplicationDelegate {
    let model = Model()
    var window: NSWindow!
    var timer: Timer?
    func textControl(_ view: NSView) -> NSTextField? {
        if let field = view as? NSTextField, field.isEditable { return field }
        return view.subviews.compactMap { textControl($0) }.first
    }
    func save() {
        let state: [String: Any] = ["pid":ProcessInfo.processInfo.processIdentifier,"count":model.count,"text":textControl(window.contentView!)?.stringValue ?? "", "modelText":model.text,"foregroundPID":NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,"windowNumber":window.windowNumber]
        try! JSONSerialization.data(withJSONObject:state).write(to:URL(fileURLWithPath:CommandLine.arguments[1]),options:.atomic)
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect:NSRect(x:100,y:100,width:550,height:300),styleMask:[.titled,.closable],backing:.buffered,defer:false)
        window.title = "Pero SwiftUI Fixture"
        window.contentView = NSHostingView(rootView:Content(model:model))
        window.orderFrontRegardless()
        timer = Timer.scheduledTimer(withTimeInterval:0.05,repeats:true) { [weak self] _ in self?.save() }
        save()
    }
}
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let fixture = Fixture()
application.delegate = fixture
_ = NSApplicationMain(CommandLine.argc,CommandLine.unsafeArgv)
