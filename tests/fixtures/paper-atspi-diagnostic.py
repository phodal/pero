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
              'pid': pid, 'bounds': bounds, 'registry': [], 'frames': [], 'nodes': [],
              'errors': [], 'truncated': False, 'limits': {'depth': 4, 'nodes': 64, 'calls': 128, 'seconds': 8},
              'budgetReasons': [], 'skippedForeignPid': 0, 'unresolvedPid': 0}
    deadline = time.monotonic() + 8
    calls = 0

    def truncated(reason):
        report['truncated'] = True
        if reason not in report['budgetReasons']:
            report['budgetReasons'].append(reason)

    def read(node, interface, method, signature='()', arguments=()):
        nonlocal calls
        if calls >= 128 or time.monotonic() >= deadline:
            truncated('rpc-count' if calls >= 128 else 'elapsed-time')
            return None
        calls += 1
        try:
            return call(node, interface, method, signature, arguments)
        except Exception as error:
            report['errors'].append({'node': list(node), 'interface': interface,
                                     'getter': method, 'error': type(error).__name__,
                                     'code': getattr(error, 'code', None)})
            return None

    owners = {}

    def owned_node(node):
        bus = node[0]
        if bus not in owners:
            owners[bus] = read(('org.freedesktop.DBus', '/org/freedesktop/DBus'),
                               'org.freedesktop.DBus', 'GetConnectionUnixProcessID', '(s)', (bus,))
        if owners[bus] is None:
            report['unresolvedPid'] += 1
        elif owners[bus] != pid:
            report['skippedForeignPid'] += 1
        return owners[bus] == pid

    applications = read((REGISTRY, ROOT), ACCESSIBLE, 'GetChildren')
    if applications is None:
        report['classification'] = 'registry-read-incomplete'
        return report
    report['registryChildCount'] = len(applications)
    owned = 0
    queue = []
    queued = set()

    def enqueue(children, depth):
        for child in children:
            node = tuple(child)
            if not node[0] or node[1] == '/org/a11y/atspi/null' or node in queued:
                continue
            if len(queued) >= 64:
                truncated('node-count')
                break
            queued.add(node)
            queue.append((node, depth))

    for application in applications[:32]:
        node = tuple(application)
        is_owned = owned_node(node)
        report['registry'].append({'bus': node[0], 'pid': owners[node[0]], 'owned': is_owned})
        if not is_owned:
            continue
        owned += 1
        children = read(node, ACCESSIBLE, 'GetChildren')
        if children is not None:
            enqueue(children, 1)
    if len(applications) > 32:
        truncated('registry-count')

    # Breadth first: preserve every immediate-frame observation before descending.
    # Each new bus must resolve to the exact Electron PID, never a renderer PID.
    index = 0
    while index < len(queue):
        if calls >= 128 or time.monotonic() >= deadline:
            truncated('rpc-count' if calls >= 128 else 'elapsed-time')
            break
        node, depth = queue[index]
        index += 1
        if not owned_node(node):
            continue
        facts = {'node': list(node), 'depth': depth}
        for key, method in (('role', 'GetRole'), ('roleName', 'GetRoleName'),
                            ('states', 'GetState'), ('interfaces', 'GetInterfaces')):
            facts[key] = read(node, ACCESSIBLE, method)
        # Non-component nodes have no geometry; do not manufacture getter errors.
        facts['extents'] = (read(node, COMPONENT, 'GetExtents', '(u)', (0,))
                            if facts['interfaces'] and COMPONENT in facts['interfaces'] else None)
        facts['matchesExistingGeometry'] = (matches(facts['extents'], bounds)
                                             if facts['extents'] is not None else None)
        states = facts['states']
        facts['rendered'] = (bool(states and states[0] & (1 << 25) and states[0] & (1 << 30))
                             if states is not None else None)
        report['nodes'].append(facts)
        if depth == 1:
            report['frames'].append(facts)
        children = read(node, ACCESSIBLE, 'GetChildren')
        if children:
            if depth == 4:
                truncated('depth')
            else:
                enqueue(children, depth + 1)
    hits = sum(f['matchesExistingGeometry'] is True for f in report['nodes'])
    report['matchingFrames'] = sum(f['matchesExistingGeometry'] is True for f in report['frames'])
    report['matchingNodes'] = hits
    report['matchingNestedNodes'] = sum(f['depth'] > 1 and f['matchesExistingGeometry'] is True for f in report['nodes'])
    report['matchingDialogCandidates'] = sum(f['matchesExistingGeometry'] is True and
        f['roleName'] in ('dialog', 'alert') for f in report['nodes'])
    report['calls'] = calls
    report['classification'] = (
        'incomplete-getters-or-budget' if report['errors'] or report['truncated'] else
        'no-exact-pid-application' if not owned else
        'no-exact-geometry-node-in-owned-subtree' if not hits else
        'ambiguous-exact-geometry-nodes' if hits > 1 else
        'one-exact-geometry-node-not-an-input-grant')
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
