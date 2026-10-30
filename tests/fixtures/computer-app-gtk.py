"""Owned GTK 3 windows for AT-SPI acceptance: callbacks, not receipts, write effects.

Two windows share one title so the driver must bind by process and geometry.
"""
import json
import os
import sys
from pathlib import Path

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

output = Path(sys.argv[1])
effects = dict(pid=os.getpid(), counts=dict(first=0, second=0), checked=False, ready=False,
               ephemeral=0, ephemeral_hidden=False)


def save(*_):
    seat = Gdk.Display.get_default().get_default_seat()
    _, x, y = seat.get_pointer().get_position()
    effects['pointer'] = dict(x=x, y=y)
    pending = output.with_suffix('.pending')
    pending.write_text(json.dumps(effects))
    pending.replace(output)


def window(key, x):
    win = Gtk.Window(title='Pero AT-SPI Fixture')
    win.set_default_size(360, 240)
    win.move(x, 80)
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
    win.add(box)

    def increment(_):
        effects['counts'][key] += 1
        save()

    button = Gtk.Button(label=f'Increment {key}')
    button.connect('clicked', increment)
    box.pack_start(button, False, False, 0)
    if key == 'first':
        check = Gtk.CheckButton(label='Remember')

        def toggled(widget):
            effects['checked'] = widget.get_active()
            save()

        check.connect('toggled', toggled)
        box.pack_start(check, False, False, 0)
        disabled = Gtk.Button(label='Disabled action')
        disabled.set_sensitive(False)
        box.pack_start(disabled, False, False, 0)
        secret = Gtk.Entry()
        secret.set_visibility(False)
        secret.set_text('fixture-secret')
        box.pack_start(secret, False, False, 0)
        ephemeral = Gtk.Button(label='Ephemeral')

        def ephemeral_clicked(_):
            effects['ephemeral'] += 1
            save()

        ephemeral.connect('clicked', ephemeral_clicked)
        box.pack_start(ephemeral, False, False, 0)

        def hide_on_request():
            # The test asks for the control to disappear between observe and act.
            if not effects['ephemeral_hidden'] and output.with_suffix('.hide').exists():
                ephemeral.hide()
                effects['ephemeral_hidden'] = True
                save()
            return True

        GLib.timeout_add(50, hide_on_request)
        draft = Gtk.Entry()
        draft.set_text('Plain draft')
        box.pack_start(draft, False, False, 0)
    win.connect('destroy', Gtk.main_quit)
    win.show_all()
    return win


windows = [window('first', 40), window('second', 460)]


def ready():
    effects['ready'] = True
    save()
    return False


GLib.timeout_add(500, ready)
Gtk.main()
