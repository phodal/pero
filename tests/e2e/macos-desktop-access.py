"""Check inherited access to the services Electron needs before launching it."""

import ctypes
import sys

system = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
system.bootstrap_look_up.argtypes = [ctypes.c_uint32, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32)]
system.bootstrap_look_up.restype = ctypes.c_int
system.bootstrap_strerror.argtypes = [ctypes.c_int]
system.bootstrap_strerror.restype = ctypes.c_char_p
bootstrap_port = ctypes.c_uint32.in_dll(system, 'bootstrap_port').value

for name in (b'com.apple.windowserver.active', b'com.apple.coreservices.launchservicesd'):
    service_port = ctypes.c_uint32()
    result = system.bootstrap_look_up(bootstrap_port, name, ctypes.byref(service_port))
    if result:
        print(f'{name.decode()}: {system.bootstrap_strerror(result).decode()} ({result})', file=sys.stderr)
        sys.exit(1)
