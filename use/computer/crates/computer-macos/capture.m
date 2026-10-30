// Capture only the already selected window. No process, file or display fallback.
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <ImageIO/ImageIO.h>
#include <math.h>

bool pero_modern_capture(void) {
    return NSProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 14;
}

// Returns a retained CFData owned by the Rust caller. Completion blocks retain
// their own state, so a timed-out capture can finish without touching caller memory.
CFDataRef pero_capture_window(uint32_t windowID, uint32_t maxPixels, uint32_t *width, uint32_t *height) API_AVAILABLE(macos(14.0));
CFDataRef pero_capture_window(uint32_t windowID, uint32_t maxPixels, uint32_t *width, uint32_t *height) {
    if (windowID == 0 || maxPixels == 0) return NULL;
        @autoreleasepool {
            dispatch_semaphore_t done = dispatch_semaphore_create(0);
            __block NSData *result = nil;
            __block uint32_t imageWidth = 0, imageHeight = 0;
            [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES
                completionHandler:^(SCShareableContent *content, NSError *error) {
                    if (error) { dispatch_semaphore_signal(done); return; }
                    SCWindow *selected = nil;
                    for (SCWindow *window in content.windows) if (window.windowID == windowID) { selected = window; break; }
                    if (!selected || selected.frame.size.width <= 0 || selected.frame.size.height <= 0) {
                        dispatch_semaphore_signal(done); return;
                    }
                    SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:selected];
                    SCStreamConfiguration *config = [SCStreamConfiguration new];
                    double scale = MIN(filter.pointPixelScale, (double)maxPixels / MAX(selected.frame.size.width, selected.frame.size.height));
                    config.width = MAX(1, llround(selected.frame.size.width * scale));
                    config.height = MAX(1, llround(selected.frame.size.height * scale));
                    config.showsCursor = NO;
                    config.ignoreShadowsSingleWindow = YES;
                    config.scalesToFit = YES;
                    [SCScreenshotManager captureImageWithFilter:filter configuration:config
                        completionHandler:^(CGImageRef image, NSError *captureError) {
                            if (image && !captureError) {
                                NSMutableData *bytes = [NSMutableData data];
                                CGImageDestinationRef destination = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)bytes, CFSTR("public.jpeg"), 1, NULL);
                                if (destination) {
                                    CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)@{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality:@0.8});
                                    if (CGImageDestinationFinalize(destination)) {
                                        result = bytes;
                                        imageWidth = (uint32_t)CGImageGetWidth(image);
                                        imageHeight = (uint32_t)CGImageGetHeight(image);
                                    }
                                    CFRelease(destination);
                                }
                            }
                            dispatch_semaphore_signal(done);
                        }];
                }];
            if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) return NULL;
            if (!result.length || !imageWidth || !imageHeight) return NULL;
            *width = imageWidth; *height = imageHeight;
            return CFBridgingRetain(result);
        }
}
