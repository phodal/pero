"""Opt-in probe of one exact public callback, with synthetic inputs only.

Usage: python pcgym_callback_probe.py /approved/pc-gym/.../custom_reward.py
No PC-Gym environment, DDPG policy, original trajectory or scientific replication.
"""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
from types import SimpleNamespace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    args = parser.parse_args()
    path = Path(args.source).absolute()
    if path.resolve() != path or not path.is_file() or path.stat().st_size > 16384:
        raise ValueError('Supply the canonical bounded original source file')
    raw = path.read_bytes()
    blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    if blob != '284967c39bfd7b444378810373cb805f9584c914':
        raise ValueError('Source bytes differ from the reviewed callback; nothing was executed')
    import numpy as np
    function = runpy.run_path(str(path))['con_reward']

    def environment():
        return SimpleNamespace(model=SimpleNamespace(info=lambda: {'states': ['Ca', 'T']}),
            SP={'Ca': np.array([.85])}, t=0,
            env_params={'SP': {'Ca': np.array([.85])},
                        'o_space': {'low': np.array([.7, 300]), 'high': np.array([1., 350])},
                        'a_space': {'low': np.array([290]), 'high': np.array([310])},
                        'r_scale': {'Ca': 1}})

    without = float(function(environment(), np.array([.85, 324.]), np.array([300.]), False))
    with_penalty = float(function(environment(), np.array([.85, 324.]), np.array([300.]), True))
    print(json.dumps({'kind': 'upstream-callback-probe', 'git_blob': blob,
        'sha256': hashlib.sha256(raw).hexdigest(), 'input_origin': 'synthetic-callback-inputs',
        'temperature_kelvin': 324., 'reward_without_penalty': without,
        'reward_with_penalty': with_penalty, 'extra_cost': without - with_penalty,
        'scope': 'Exact published pure function only; no PC-Gym environment or policy replication.'}, indent=2))


if __name__ == '__main__':
    main()
