"""Read-only, bounded AT-SPI facts for an already verified owned fixture window.

Invoke only inside the disposable Paper fixture bus, after exact native-driver
PID exclusion has verified ownership. This cannot authorize input and does not
replace the native driver's binding or semantic gates. No text/value is read.
"""
import argparse
import json
import os
import signal
import math
import time

ROOT = '/org/a11y/atspi/accessible/root'
ACCESSIBLE = 'org.a11y.atspi.Accessible'
COMPONENT = 'org.a11y.atspi.Component'
REGISTRY = 'org.a11y.atspi.Registry'


def matches(extents, bounds):
    # Exact existing driver rule: all four screen coordinates within ±2.
    return len(extents) == 4 and all(abs(a - b) <= 2 for a, b in zip(extents, bounds))


def collect(call, pid, bounds):
    report = {'scope': 'read-only owned fixture metadata; never an input grant',
              'pid': pid, 'bounds': bounds, 'registry': [], 'frames': [],
              'errors': [], 'truncated': False}
    deadline = time.monotonic() + 8
    calls = 0

    def read(node, interface, method, signature='()', arguments=()):
        nonlocal calls
        if calls >= 128 or time.monotonic() >= deadline:
            report['truncated'] = True
            return None
        calls += 1
        try:
            return call(node, interface, method, signature, arguments)
        except Exception as error:
            # Preserve operation/error class, not exception text that may include
            # application content or an arbitrary remote error payload.
            report['errors'].append({'node': list(node), 'interface': interface,
                                     'getter': method, 'error': type(error).__name__,
                                     'code': getattr(error, 'code', None)})
            return None

    applications = read((REGISTRY, ROOT), ACCESSIBLE, 'GetChildren')
    if applications is None:
        report['classification'] = 'registry-read-incomplete'
        return report
    report['registryChildCount'] = len(applications)
    owned = 0
    for application in applications[:32]:
        bus, path = application
        owner = read(('org.freedesktop.DBus', '/org/freedesktop/DBus'),
                     'org.freedesktop.DBus', 'GetConnectionUnixProcessID', '(s)', (bus,))
        report['registry'].append({'bus': bus, 'pid': owner, 'owned': owner == pid})
        if owner != pid:
            continue
        owned += 1
        frames = read((bus, path), ACCESSIBLE, 'GetChildren')
        if frames is None:
            continue
        if len(frames) > 32:
            report['truncated'] = True
        for frame in frames[:32]:
            node = tuple(frame)
            facts = {'node': list(node)}
            for key, interface, method, signature, args in (
                ('role', ACCESSIBLE, 'GetRole', '()', ()),
                ('roleName', ACCESSIBLE, 'GetRoleName', '()', ()),
                ('states', ACCESSIBLE, 'GetState', '()', ()),
                ('interfaces', ACCESSIBLE, 'GetInterfaces', '()', ()),
                ('extents', COMPONENT, 'GetExtents', '(u)', (0,)),
            ):
                facts[key] = read(node, interface, method, signature, args)
            if facts['interfaces'] and 'org.a11y.atspi.Action' in facts['interfaces']:
                count = read(node, 'org.freedesktop.DBus.Properties', 'Get',
                             '(ss)', ('org.a11y.atspi.Action', 'NActions'))
                facts['actionCount'] = count
                facts['actionNames'] = [read(node, 'org.a11y.atspi.Action', 'GetName', '(i)', (index,))
                                        for index in range(max(0, min(count or 0, 16)))]
            facts['matchesExistingGeometry'] = (matches(facts['extents'], bounds)
                                                 if facts['extents'] is not None else None)
            states = facts['states']
            facts['rendered'] = (bool(states and states[0] & (1 << 25) and states[0] & (1 << 30))
                                 if states is not None else None)
            report['frames'].append(facts)
    if len(applications) > 32:
        report['truncated'] = True
    hits = sum(f['matchesExistingGeometry'] is True for f in report['frames'])
    report['matchingFrames'] = hits
    report['classification'] = (
        'incomplete-getters-or-budget' if report['errors'] or report['truncated'] else
        'no-exact-pid-application' if not owned else
        'no-exact-geometry-frame' if not hits else
        'ambiguous-exact-geometry' if hits > 1 else
        'one-frame-matches-inspect-root-facts')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', required=True, type=int)
    parser.add_argument('--bounds', required=True, nargs=4, type=float, metavar=('X', 'Y', 'W', 'H'))
    args = parser.parse_args()
    if os.environ.get('PERO_PAPER_NATIVE_DBUS') != '1' or not os.environ.get('DBUS_SESSION_BUS_ADDRESS'):
        parser.error('Requires the existing disposable Paper fixture D-Bus session')
    if args.pid <= 0 or not all(math.isfinite(n) for n in args.bounds) or args.bounds[2] <= 0 or args.bounds[3] <= 0:
        parser.error('Requires a verified positive PID and window dimensions')
    from gi.repository import Gio, GLib
    session = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    address = session.call_sync('org.a11y.Bus', '/org/a11y/bus', 'org.a11y.Bus',
                                'GetAddress', None, None, Gio.DBusCallFlags.NONE, 500, None).unpack()[0]
    bus = Gio.DBusConnection.new_for_address_sync(address,
        Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)

    def call(node, interface, method, signature, arguments):
        reply = bus.call_sync(node[0], node[1], interface, method,
                              GLib.Variant(signature, arguments), None,
                              Gio.DBusCallFlags.NONE, 500, None).unpack()
        return reply[0] if len(reply) == 1 else reply

    print(json.dumps(collect(call, args.pid, args.bounds), indent=2))


if __name__ == '__main__':
    def timed_out(signum, frame):
        raise TimeoutError('bounded read-only diagnostic expired')
    signal.signal(signal.SIGALRM, timed_out)
    signal.alarm(10)
    try:
        main()
    except Exception as error:
        print(json.dumps({'classification': 'connection-or-process-failure',
                          'error': type(error).__name__, 'truncated': True}))
        raise SystemExit(2)
    finally:
        signal.alarm(0)
