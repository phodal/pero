"""Explicitly authorized local execution of the fixed PC-Gym case.

No installation, network acquisition, arbitrary commands, pickle import or model
client. The caller/Host owns this foreground process and cancellation. This is
NOT an OS sandbox; run only in an operator-prepared scientific environment.
"""
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import random
import platform
import sys

from .pcgym_domain import Invalid, Observation, POLICIES, canonical, digest
from .pcgym_sources import CASE, package_inventory, read_checkout, pipeline_digest


def preflight(spec, checkout):
    if platform.python_version() != spec.python_version or pipeline_digest() != spec.pipeline_digest:
        raise Invalid('implementation_changed', 'Python or the research/checker implementation differs from the frozen specification')
    root, sources, manifest = read_checkout(checkout)
    if digest(manifest) != spec.source_manifest_digest:
        raise Invalid('source_changed', 'The checkout differs from the source manifest frozen into this specification')
    observed = package_inventory()
    missing = [name for name, version in observed.items() if version == 'MISSING']
    if missing:
        raise Invalid('dependency_missing', 'Prepare the scientific environment explicitly: ' + ', '.join(missing))
    if observed != dict(spec.packages):
        raise Invalid('environment_changed', 'Installed dependency versions differ from the frozen environment')
    return root, manifest


def run_case(spec, checkout, attempt_id, output):
    """Invoke real PC-Gym/SB3; never substitute analytic/synthetic results."""
    root, source_manifest = preflight(spec, checkout)
    output = Path(output)
    sys.path.insert(0, str(root / 'src'))
    import numpy as np
    import torch
    import pcgym
    from stable_baselines3 import DDPG
    if not Path(pcgym.__file__).resolve().is_relative_to(root / 'src' / 'pcgym'):
        raise Invalid('import_origin', 'PC-Gym was imported from a different source tree')
    # Only this fixed, blob-checked reward file is executed, after approval.
    definition = importlib.util.spec_from_file_location('pero_pinned_cstr_reward', root / CASE / 'custom_reward.py')
    module = importlib.util.module_from_spec(definition)
    definition.loader.exec_module(module)
    reward = module.con_reward
    torch.set_num_threads(1)

    def seed_all(seed):
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)

    def params(constrained):
        values = {
            'N': spec.samples, 'tsim': 26,
            'SP': {'Ca': [0.86, 0.9] * (spec.samples // 2)},
            'o_space': {'low': np.array([0.7, 300., 0.8]), 'high': np.array([1., 350., 0.9])},
            'a_space': {'low': np.array([290.]), 'high': np.array([310.])},
            'x0': np.array([0.8, 325., 0.86]), 'r_scale': {'Ca': 1}, 'model': 'cstr',
            'normalise_a': True, 'normalise_o': True, 'noise': True,
            'integration_method': 'casadi', 'noise_percentage': 0.001,
            'custom_reward': reward,
        }
        if constrained:
            values.update(done_on_cons_vio=False, constraints={'T': [327, 321]},
                          r_penalty=False, cons_type={'T': ['<=', '>=']})
        return values

    checkpoint_hashes = {}
    training = {}
    trajectories = {}
    events = output / 'events.jsonl'

    def event(stage, **data):
        with events.open('ab') as stream:
            stream.write(canonical({'stage': stage, **data}) + b'\n')
        print(json.dumps({'stage': stage, **data}), flush=True)

    # Same frozen training seed for both reward variants; exact originals unknown.
    trained = {}
    for name, constrained in (('shaped', True), ('base', False)):
        event('training', policy=name, steps=spec.steps)
        seed_all(spec.seed)
        env = pcgym.make_env(deepcopy(params(constrained)))
        try:
            model = DDPG('MlpPolicy', env, verbose=0, learning_rate=0.001,
                         seed=spec.seed, device='cpu')
            model.learn(total_timesteps=spec.steps)
            training[name] = {'requested_timesteps': spec.steps,
                              'actual_timesteps': model.num_timesteps,
                              'learning_starts': model.learning_starts,
                              'gradient_updates': model._n_updates}
            event('training-complete', policy=name, **training[name])
            model.save(str(output / (name + '-checkpoint')))
            checkpoint = output / (name + '-checkpoint.zip')
            checkpoint_hashes[checkpoint.name] = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
            trained[name] = model
        finally:
            env.close()

    # Use public upstream evaluation, preserving its initial-state-inclusive grid.
    # A fresh evaluator per policy and episode makes the randomness explicit.
    raw = {name: [] for name in POLICIES}
    for episode in range(spec.episodes):
        evaluation_seed = spec.seed + 10000 + episode
        for name in ('base', 'shaped'):
            event('evaluation', policy=name, episode=episode, seed=evaluation_seed)
            seed_all(evaluation_seed)
            env = pcgym.make_env(deepcopy(params(True)))
            try:
                evaluator, data = env.get_rollouts({'DDPG': trained[name]}, reps=1, oracle=False)
                raw[name].append(data['DDPG'])
                evaluator.env.close()
            finally:
                env.close()
        event('evaluation', policy='oracle', episode=episode, seed=evaluation_seed)
        seed_all(evaluation_seed)
        env = pcgym.make_env(deepcopy(params(True)))
        try:
            evaluator, data = env.get_rollouts({}, reps=1, oracle=True, MPC_params={'N': 20})
            raw['oracle'].append(data['oracle'])
            evaluator.env.close()
        finally:
            env.close()

    for name in POLICIES:
        temperatures = []
        arrays = {}
        for episode, result in enumerate(raw[name]):
            x = np.asarray(result['x'])
            if x.ndim != 3 or x.shape[0] < 2 or x.shape[1:] != (spec.samples, 1):
                raise Invalid('solver_shape', f'Unexpected raw state shape for {name}: {x.shape}')
            if not np.isfinite(x).all():
                raise Invalid('solver_non_finite', 'Actual solver observations contain non-finite values')
            temperatures.append(x[1, :, 0].tolist())
            for field in ('x', 'u', 'r'):
                array = np.asarray(result[field])
                if array.dtype.hasobject or not np.isfinite(array).all():
                    raise Invalid('solver_output', f'Invalid numeric {field} for {name}')
                arrays[f'episode_{episode}_{field}'] = array
        # Numeric npz only; readers use allow_pickle=False. No third-party pickle.
        np.savez_compressed(output / f'{name}-raw.npz', **arrays)
        trajectories[name] = {'policy': name, 'temperature_unit': 'K',
                              'includes_initial_state': True, 'temperatures': temperatures}
    observation = {'schema': 'pero.pcgym.observation.v1', 'spec_id': spec.id,
                   'attempt_id': attempt_id, 'origin': 'pcgym-execution',
                   'policies': [trajectories[name] for name in POLICIES]}
    Observation.parse(observation, spec)
    # Recheck code and environment after execution; an unobserved mutation is not accepted.
    preflight(spec, checkout)
    event('execution-complete', policies=list(POLICIES), episodes=spec.episodes)
    return observation, {'source_manifest': source_manifest, 'checkpoints': checkpoint_hashes,
                         'training': training,
                         'python': sys.version, 'packages': package_inventory(),
                         'evaluation_seeds': [spec.seed + 10000 + i for i in range(spec.episodes)],
                         'deviations': list(spec.deviations())}
