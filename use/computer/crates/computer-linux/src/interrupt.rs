//! Stop is delivered as SIGTERM. A held pointer button must never outlive it.
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::{Duration, Instant};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::{CURRENT_TIME, connection::Connection, protocol::xproto::BUTTON_RELEASE_EVENT};

static INTERRUPTED: AtomicBool = AtomicBool::new(false);
static HELD: AtomicU8 = AtomicU8::new(0);
const SLICE: Duration = Duration::from_millis(20);

/// Installs the SIGTERM watcher once. The watcher lets an in-flight hold release
/// its button, sends one more release itself if the button is still recorded as
/// held, then exits with the conventional SIGTERM status.
pub fn install() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let Ok(mut signals) = signal_hook::iterator::Signals::new([signal_hook::consts::SIGTERM])
        else {
            return;
        };
        std::thread::spawn(move || {
            if signals.forever().next().is_some() {
                INTERRUPTED.store(true, Ordering::SeqCst);
                let deadline = Instant::now() + Duration::from_millis(500);
                while HELD.load(Ordering::SeqCst) != 0 && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(5));
                }
                let button = HELD.swap(0, Ordering::SeqCst);
                if button != 0 {
                    release_on_fresh_connection(button);
                }
                std::process::exit(143);
            }
        });
    });
}

fn release_on_fresh_connection(button: u8) {
    if let Ok((c, screen)) = x11rb::connect(None) {
        let root = c.setup().roots[screen].root;
        if let Ok(cookie) =
            c.xtest_fake_input(BUTTON_RELEASE_EVENT, button, CURRENT_TIME, root, 0, 0, 0)
        {
            let _ = cookie.check();
        }
        let _ = c.flush();
    }
}

pub fn interrupted() -> bool {
    INTERRUPTED.load(Ordering::SeqCst)
}

/// Records which button is down while a hold is in progress.
pub fn set_held(button: u8) {
    HELD.store(button, Ordering::SeqCst);
}

/// Sleeps in short slices; returns false as soon as stop was requested.
pub fn wait(duration: Duration) -> bool {
    let deadline = Instant::now() + duration;
    loop {
        if interrupted() {
            return false;
        }
        let now = Instant::now();
        if now >= deadline {
            return true;
        }
        std::thread::sleep(SLICE.min(deadline - now));
    }
}
