#import <AppKit/AppKit.h>

@interface PeroPasteboardLease : NSObject
@property (nonatomic, strong) NSPasteboard *board;
@property (nonatomic, strong) NSArray<NSPasteboardItem *> *previous;
@property (nonatomic) NSInteger change;
@end
@implementation PeroPasteboardLease
@end

static BOOL restore(PeroPasteboardLease *lease) {
    if (lease.board.changeCount != lease.change) return YES;
    [lease.board clearContents];
    return !lease.previous.count || [lease.board writeObjects:lease.previous];
}

void *pero_pasteboard_stage(const uint8_t *payload, size_t length, bool html) {
    @autoreleasepool {
        NSPasteboard *board = NSPasteboard.generalPasteboard;
        NSInteger originalChange = board.changeCount;
        NSMutableArray<NSPasteboardItem *> *previous = [NSMutableArray new];
        size_t remaining = 64 * 1024 * 1024;
        for (NSPasteboardItem *original in board.pasteboardItems) {
            NSPasteboardItem *copy = [NSPasteboardItem new];
            for (NSPasteboardType type in original.types) {
                NSData *data = [original dataForType:type];
                if (!data || data.length > remaining || ![copy setData:data forType:type])
                    return NULL;
                remaining -= data.length;
            }
            if (copy.types.count) [previous addObject:copy];
        }
        if (board.changeCount != originalChange) return NULL;

        NSPasteboardItem *item = [NSPasteboardItem new];
        if (![item setData:[NSData dataWithBytes:payload length:length]
                   forType:html ? NSPasteboardTypeHTML : NSPasteboardTypeString]) return NULL;

        PeroPasteboardLease *lease = [PeroPasteboardLease new];
        lease.board = board;
        lease.previous = previous;
        lease.change = [board clearContents];
        if (![board writeObjects:@[item]]) {
            restore(lease);
            return NULL;
        }
        lease.change = board.changeCount;
        return (__bridge_retained void *)lease;
    }
}

bool pero_pasteboard_owns(void *handle) {
    @autoreleasepool {
        PeroPasteboardLease *lease = (__bridge PeroPasteboardLease *)handle;
        return lease.board.changeCount == lease.change;
    }
}

bool pero_pasteboard_restore(void *handle) {
    @autoreleasepool {
        PeroPasteboardLease *lease = (__bridge_transfer PeroPasteboardLease *)handle;
        return restore(lease);
    }
}
