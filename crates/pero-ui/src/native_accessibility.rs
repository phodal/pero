//! Compose the embedded WebKit tree with the existing GPUI accessibility tree.
//! AccessKit owns the content view's virtual children; AppKit subviews must also
//! remain reachable when a native App is visible.
use crate::native_web::{ObjcPoint, ObjcRect};
use gpui_kit::Window;
use objc2::{
    msg_send,
    runtime::{AnyClass, AnyObject, ClassBuilder, Sel},
    sel,
};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::ffi::CString;

pub(crate) fn attach(window: &Window) {
    let Ok(handle) = HasWindowHandle::window_handle(window) else {
        return;
    };
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return;
    };
    // The GPUI window owns this view and all calls run on its UI thread.
    unsafe {
        let view = handle.ns_view.as_ptr().cast::<AnyObject>();
        let ns_window: *mut AnyObject = msg_send![view, window];
        let content: *mut AnyObject = msg_send![ns_window, contentView];
        if content.is_null() {
            return;
        }
        let parent = (&*content).class();
        if parent
            .name()
            .to_bytes()
            .starts_with(b"PeroEmbeddedAccessibility_")
        {
            return;
        }
        let name = CString::new(format!(
            "PeroEmbeddedAccessibility_{}",
            parent.name().to_string_lossy()
        ))
        .unwrap();
        let class = AnyClass::get(&name).unwrap_or_else(|| {
            let mut class =
                ClassBuilder::new(&name, parent).expect("unique accessibility subclass");
            class.add_method(
                sel!(accessibilityChildren),
                children as unsafe extern "C" fn(_, _) -> _,
            );
            class.add_method(
                sel!(accessibilityChildrenInNavigationOrder),
                children as unsafe extern "C" fn(_, _) -> _,
            );
            class.add_method(
                sel!(accessibilityHitTest:),
                hit_test as unsafe extern "C" fn(_, _, ObjcPoint) -> _,
            );
            class.add_method(
                sel!(accessibilityFocusedUIElement),
                focused as unsafe extern "C" fn(_, _) -> _,
            );
            class.register()
        });
        objc2::ffi::object_setClass(content, class as *const AnyClass as *mut AnyClass);
    }
}

unsafe extern "C" fn children(this: &AnyObject, _selector: Sel) -> *mut AnyObject {
    unsafe {
        let parent = this
            .class()
            .superclass()
            .expect("accessibility parent class");
        let original: *mut AnyObject = msg_send![super(this, parent), accessibilityChildren];
        let array = AnyClass::get(c"NSMutableArray").unwrap();
        let result: *mut AnyObject = msg_send![array, array];
        if !original.is_null() {
            let _: () = msg_send![result, addObjectsFromArray: original];
        }
        visit_webviews(this, &mut |view| {
            let children: *mut AnyObject = msg_send![view, accessibilityChildren];
            if !children.is_null() {
                let _: () = msg_send![result, addObjectsFromArray: children];
            }
        });
        result
    }
}

unsafe fn visit_webviews(view: &AnyObject, visit: &mut impl FnMut(&AnyObject)) {
    unsafe {
        let hidden: bool = msg_send![view, isHiddenOrHasHiddenAncestor];
        if hidden {
            return;
        }
        if let Some(web_class) = AnyClass::get(c"WKWebView") {
            let web: bool = msg_send![view, isKindOfClass: web_class];
            if web {
                visit(view);
                return;
            }
        }
        let subviews: *mut AnyObject = msg_send![view, subviews];
        let count: usize = msg_send![subviews, count];
        for index in 0..count {
            let child: *mut AnyObject = msg_send![subviews, objectAtIndex: index];
            visit_webviews(&*child, visit);
        }
    }
}

// AppKit's accessibility points and frames share screen coordinates.
unsafe extern "C" fn hit_test(
    this: &AnyObject,
    _selector: Sel,
    point: ObjcPoint,
) -> *mut AnyObject {
    unsafe {
        let mut found: *mut AnyObject = std::ptr::null_mut();
        visit_webviews(this, &mut |view| {
            let frame: ObjcRect = msg_send![view, accessibilityFrame];
            if point.x >= frame.origin.x
                && point.x < frame.origin.x + frame.size.width
                && point.y >= frame.origin.y
                && point.y < frame.origin.y + frame.size.height
            {
                found = msg_send![view, accessibilityHitTest: point];
            }
        });
        if !found.is_null() {
            return found;
        }
        let parent = this
            .class()
            .superclass()
            .expect("accessibility parent class");
        msg_send![super(this, parent), accessibilityHitTest: point]
    }
}

unsafe extern "C" fn focused(this: &AnyObject, _selector: Sel) -> *mut AnyObject {
    unsafe {
        let window: *mut AnyObject = msg_send![this, window];
        let responder: *mut AnyObject = msg_send![window, firstResponder];
        let mut found: *mut AnyObject = std::ptr::null_mut();
        if !responder.is_null() {
            let is_view: bool =
                msg_send![responder, isKindOfClass: AnyClass::get(c"NSView").unwrap()];
            if is_view {
                visit_webviews(this, &mut |view| {
                    let inside: bool = msg_send![responder, isDescendantOf: view];
                    if inside {
                        found = msg_send![view, accessibilityFocusedUIElement];
                    }
                });
            }
        }
        if !found.is_null() {
            return found;
        }
        let parent = this
            .class()
            .superclass()
            .expect("accessibility parent class");
        msg_send![super(this, parent), accessibilityFocusedUIElement]
    }
}
