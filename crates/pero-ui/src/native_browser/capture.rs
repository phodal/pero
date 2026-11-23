//! WebKit viewport capture and frame-origin validation.
use super::webkit;
use crate::native_web::{ObjcPoint, ObjcRect, ObjcSize};
use objc2::{
    class, msg_send,
    rc::Retained,
    runtime::{AnyObject, Bool},
    sel,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{ffi::CStr, ptr};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGImageGetWidth(image: *mut std::ffi::c_void) -> usize;
    fn CGImageGetHeight(image: *mut std::ffi::c_void) -> usize;
    fn CGImageCreateWithImageInRect(
        image: *mut std::ffi::c_void,
        rect: ObjcRect,
    ) -> *mut std::ffi::c_void;
}

#[derive(Clone, Copy, Deserialize)]
pub(super) struct ScreenshotClip {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

pub(super) fn check_frames(
    view: &wry::WebView,
    origin: &str,
    reply: impl Fn(anyhow::Result<Value>) + 'static,
) -> anyhow::Result<()> {
    let view = webkit(view);
    let expected = url::Url::parse(origin)?;
    let available: Bool = unsafe { msg_send![&*view, respondsToSelector: sel!(_frames:)] };
    anyhow::ensure!(
        available.as_bool(),
        "WebKit cannot verify the viewport’s frame origins."
    );
    let complete = block2::RcBlock::new(move |root: *mut AnyObject| {
        reply((|| {
            anyhow::ensure!(
                !root.is_null(),
                "WebKit did not return the viewport’s frame tree."
            );
            let mut frames = vec![root];
            let mut inspected = 0;
            while let Some(frame) = frames.pop() {
                unsafe {
                    let has_info: Bool = msg_send![frame, respondsToSelector: sel!(info)];
                    anyhow::ensure!(
                        has_info.as_bool(),
                        "WebKit cannot verify the viewport’s frame origins."
                    );
                    let info: *mut AnyObject = msg_send![frame, info];
                    let security: *mut AnyObject = msg_send![info, securityOrigin];
                    let protocol: *mut AnyObject = msg_send![security, protocol];
                    let host: *mut AnyObject = msg_send![security, host];
                    let port: isize = msg_send![security, port];
                    let protocol: *const std::ffi::c_char = msg_send![protocol, UTF8String];
                    let host: *const std::ffi::c_char = msg_send![host, UTF8String];
                    let accepted = !protocol.is_null()
                        && !host.is_null()
                        && CStr::from_ptr(protocol).to_bytes() == expected.scheme().as_bytes()
                        && expected.host_str().is_some_and(|name| {
                            name.trim_matches(['[', ']']).as_bytes()
                                == CStr::from_ptr(host).to_bytes()
                        })
                        && if port == 0 {
                            expected.port().is_none()
                        } else {
                            expected.port_or_known_default() == u16::try_from(port).ok()
                        };
                    anyhow::ensure!(
                        accepted,
                        "The viewport contains a frame outside the authorized site."
                    );
                    let children: *mut AnyObject = msg_send![frame, childFrames];
                    let count: usize = msg_send![children, count];
                    inspected += 1;
                    anyhow::ensure!(
                        inspected + frames.len() + count <= 3000,
                        "The viewport exceeds the frame limit."
                    );
                    for index in 0..count {
                        let child: *mut AnyObject = msg_send![children, objectAtIndex: index];
                        frames.push(child);
                    }
                }
            }
            Ok(Value::Null)
        })());
    });
    unsafe {
        let _: () = msg_send![&*view, _frames: &*complete];
    }
    Ok(())
}

pub(super) fn capture(
    view: &wry::WebView,
    clip: Option<ScreenshotClip>,
    reply: impl Fn(anyhow::Result<Value>) + 'static,
) {
    let view = webkit(view);
    let complete = block2::RcBlock::new(move |image: *mut AnyObject, error: *mut AnyObject| {
        reply((|| {
            anyhow::ensure!(
                error.is_null() && !image.is_null(),
                "WebKit could not capture the viewport."
            );
            unsafe {
                let full: *mut std::ffi::c_void = msg_send![image, CGImageForProposedRect: ptr::null_mut::<ObjcRect>(),
                    context: ptr::null::<AnyObject>(), hints: ptr::null::<AnyObject>()];
                anyhow::ensure!(!full.is_null(), "The browser screenshot is empty.");
                let (width, height) = (CGImageGetWidth(full), CGImageGetHeight(full));
                let pixels = if let Some(clip) = clip {
                    let (x, y, w, h) = (
                        clip.x as usize,
                        clip.y as usize,
                        clip.width as usize,
                        clip.height as usize,
                    );
                    anyhow::ensure!(
                        w != 0 && h != 0 && x + w <= width && y + h <= height,
                        "The screenshot clip must fit inside the visible viewport."
                    );
                    CGImageCreateWithImageInRect(
                        full,
                        ObjcRect {
                            origin: ObjcPoint {
                                x: f64::from(clip.x),
                                y: f64::from(clip.y),
                            },
                            size: ObjcSize {
                                width: f64::from(clip.width),
                                height: f64::from(clip.height),
                            },
                        },
                    )
                } else {
                    full
                };
                anyhow::ensure!(!pixels.is_null(), "The browser screenshot is empty.");
                let size = (CGImageGetWidth(pixels), CGImageGetHeight(pixels));
                let alloc: objc2::rc::Allocated<AnyObject> =
                    msg_send![class!(NSBitmapImageRep), alloc];
                let rep: Option<Retained<AnyObject>> = msg_send![alloc, initWithCGImage: pixels];
                if clip.is_some() {
                    super::CFRelease(pixels);
                }
                let rep = rep
                    .ok_or_else(|| anyhow::anyhow!("WebKit could not encode screenshot pixels."))?;
                let properties: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
                let png: *mut AnyObject =
                    msg_send![&*rep, representationUsingType: 4usize, properties: properties]; // PNG
                let length: usize = msg_send![png, length];
                anyhow::ensure!(
                    length > 0 && length <= 4 * 1024 * 1024,
                    "The browser screenshot is empty or exceeds 4 MiB."
                );
                let encoded: *mut AnyObject =
                    msg_send![png, base64EncodedStringWithOptions: 0usize];
                let bytes: *const std::ffi::c_char = msg_send![encoded, UTF8String];
                anyhow::ensure!(
                    !bytes.is_null(),
                    "WebKit could not encode screenshot bytes."
                );
                Ok(
                    json!({"base64":CStr::from_ptr(bytes).to_str()?, "width":size.0, "height":size.1}),
                )
            }
        })());
    });
    unsafe {
        let _: () = msg_send![&*view, takeSnapshotWithConfiguration: ptr::null::<AnyObject>(), completionHandler: &*complete];
    }
}
