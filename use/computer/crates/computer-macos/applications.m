#import <AppKit/AppKit.h>
// Running identity comes from LaunchServices, without reading an application's files.
bool pero_application_bundle_id(int32_t pid, char *buffer, size_t capacity) {
    @autoreleasepool {
        NSString *identifier = [NSRunningApplication runningApplicationWithProcessIdentifier:pid].bundleIdentifier;
        return identifier.length && [identifier getCString:buffer maxLength:capacity encoding:NSUTF8StringEncoding];
    }
}

bool pero_activate_application(int32_t pid) {
    @autoreleasepool {
        return [[NSRunningApplication runningApplicationWithProcessIdentifier:pid] activateWithOptions:NSApplicationActivateIgnoringOtherApps];
    }
}
