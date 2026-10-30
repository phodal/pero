"""Owned X11/Tk window: callbacks, rather than input receipts, write effects."""
import json
import os
from pathlib import Path
import subprocess
import re
import sys
import tkinter as tk

output = Path(sys.argv[1])
root = tk.Tk()
root.title('Pero Computer Fixture')
root.geometry('600x440+100+100')
effects = dict(count=0, clicks=0, scroll=0, drags=0, text='', pid=os.getpid())
text = tk.StringVar()

def save(*_):
    effects['text'] = text.get()
    effects['entry_focused'] = root.focus_get() == entry
    effects['pointer'] = dict(x=root.winfo_pointerx(), y=root.winfo_pointery())
    effects['bounds'] = dict(x=root.winfo_rootx(), y=root.winfo_rooty())
    effects['rectangle'] = canvas.coords(rectangle)
    pending = output.with_suffix('.pending')
    pending.write_text(json.dumps(effects))
    pending.replace(output)

def change(key, delta):
    effects[key] += delta
    save()

button = tk.Button(root, text='Increment', command=lambda: change('count', 1))
button.place(x=25, y=25, width=120, height=35)
entry = tk.Entry(root, textvariable=text)
entry.place(x=170, y=25, width=400, height=32)
canvas = tk.Canvas(root, bg='white')
canvas.place(x=25, y=100, width=550, height=300)
rectangle = canvas.create_rectangle(30, 70, 120, 130, fill='blue')
drag_origin = None

def press(event):
    global drag_origin
    drag_origin = (event.x, event.y) if rectangle in canvas.find_overlapping(event.x, event.y, event.x, event.y) else None
    change('clicks', 1)

def drag(event):
    global drag_origin
    if drag_origin is not None:
        canvas.move(rectangle, event.x - drag_origin[0], event.y - drag_origin[1])
        drag_origin = (event.x, event.y)
        change('drags', 1)

def release(_):
    global drag_origin
    drag_origin = None
    save()

canvas.bind('<Button-1>', press)
canvas.bind('<B1-Motion>', drag)
canvas.bind('<ButtonRelease-1>', release)
canvas.bind('<Button-4>', lambda event: change('scroll', -1))
canvas.bind('<Button-5>', lambda event: change('scroll', 1))
text.trace_add('write', save)

def ready():
    # Tk does not publish this optional EWMH property without a window manager.
    # Set it on its owned frame; the production driver still discovers by PID.
    root.update_idletasks()
    info = subprocess.check_output(['xwininfo', '-id', hex(root.winfo_id()), '-tree'], text=True)
    xid = int(re.search(r'Parent window id: (0x[0-9a-f]+)', info).group(1), 16)
    subprocess.run(['xprop', '-id', str(xid), '-f', '_NET_WM_PID', '32c', '-set', '_NET_WM_PID', str(os.getpid())], check=True)
    root.focus_force()
    save()

root.update()
ready()
root.mainloop()
