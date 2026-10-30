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
canvas.create_rectangle(30, 70, 120, 130, fill='blue')
canvas.bind('<Button-1>', lambda event: change('clicks', 1))
canvas.bind('<B1-Motion>', lambda event: change('drags', 1))
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
