"""Explicitly enabled local PC-Gym numerical adapter, not a shell or Agent executor."""
from copy import deepcopy
import hashlib
import importlib.metadata as metadata
import importlib.util
import json
import os
from pathlib import Path
import platform
import time

from .reproduction import COMMIT, Environment, ReproductionError, Trajectory, canonical

PACKAGES = ('pcgym', 'numpy', 'scipy', 'casadi', 'gymnasium', 'stable-baselines3',
            'torch', 'do-mpc', 'jax', 'jaxlib', 'diffrax', 'equinox')


class RunStopped(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def observe_environment():
    """Read metadata before any scientific import. No install or network access."""
    packages, reasons = [], []
    for name in PACKAGES:
        try:
            packages.append((name, metadata.version(name)))
        except metadata.PackageNotFoundError:
            reasons.append(f'Missing {name}')
    commit, source_digest = '', ''
    try:
        distribution = metadata.distribution('pcgym')
        direct = json.loads(distribution.read_text('direct_url.json') or '{}')
        commit = direct.get('vcs_info', {}).get('commit_id', '')
        if commit != COMMIT:
            reasons.append('Install pcgym from the reviewed Git commit; a version number alone is insufficient')
        definition = importlib.util.find_spec('pcgym')
        roots = list(definition.submodule_search_locations or ()) if definition else []
        if len(roots) != 1:
            reasons.append('Cannot locate the installed pcgym source')
        else:
            root = Path(roots[0])
            files = sorted(root.rglob('*.py'))
            if not files or len(files) > 500 or any(p.is_symlink() for p in files):
                reasons.append('Installed pcgym source is unavailable or unsupported')
            else:
                manifest = [(str(p.relative_to(root)), hashlib.sha256(p.read_bytes()).hexdigest()) for p in files]
                manifest.append(('pero-adapter', hashlib.sha256(Path(__file__).read_bytes()).hexdigest()))
                source_digest = hashlib.sha256(canonical(manifest)).hexdigest()
    except (metadata.PackageNotFoundError, OSError, ValueError) as error:
        reasons.append(f'Cannot inspect pcgym installation: {type(error).__name__}')
    if os.environ.get('PERO_PCGYM_EXECUTION') != '1':
        reasons.append('Local simulation is disabled; the operator must set PERO_PCGYM_EXECUTION=1')
    return Environment(platform.python_version(), tuple(packages), commit, source_digest,
                       not reasons, tuple(reasons))


def execute(spec, emit, progress, cancelled):
    """Run actual PC-Gym + SB3/CasADi. Never substitute an analytic or fixture engine.

    This is a revised experiment: explicit seeds, independent parameter dictionaries,
    reset reward history, and a linear inequality penalty. Original Table 6 policies
    and its metric interpretation are not established by this adapter.
    """
    spec.require_environment(observe_environment())
    import numpy as np
    import torch
    from pcgym import make_env
    from pcgym.oracle import oracle
    from stable_baselines3 import DDPG
    from stable_baselines3.common.callbacks import BaseCallback

    deadline = time.monotonic() + spec.max_seconds
    torch.set_num_threads(1)

    def checkpoint():
        if cancelled.is_set():
            raise RunStopped('cancelled', 'Cancellation observed at a numerical checkpoint')
        if time.monotonic() > deadline:
            raise RunStopped('failed', 'The frozen cooperative execution deadline was exceeded')

    class Progress(BaseCallback):
        def __init__(self, policy):
            super().__init__(); self.policy = policy

        def _on_step(self):
            checkpoint()
            if self.num_timesteps % 500 == 0:
                progress(dict(phase='training', policy=self.policy, steps=self.num_timesteps,
                              total=spec.training_steps))
            return True

    def reward(shaped):
        def calculate(env, x, u, con=False):
            previous = getattr(env, '_pero_previous_u', None)
            previous_t = getattr(env, '_pero_previous_t', -1)
            if previous is None or env.t <= previous_t:
                previous = u
            target = env.SP['Ca'][env.t]
            cost = ((float(x[0]) - target) / .3) ** 2
            cost += .01 * float(np.sum(((u - previous) / 20.0) ** 2))
            if shaped:
                cost += max(0.0, float(x[1]) - 327.0) + max(0.0, 321.0 - float(x[1]))
            env._pero_previous_u = np.array(u, copy=True)
            env._pero_previous_t = env.t
            return -float(cost)
        return calculate

    def parameters(shaped):
        return dict(N=60, tsim=26, SP={'Ca': [0.86, 0.9] * 30},
                    o_space=dict(low=np.array([.7, 300, .8]), high=np.array([1., 350, .9])),
                    a_space=dict(low=np.array([290.]), high=np.array([310.])),
                    x0=np.array([.8, 325., .86]), r_scale={'Ca': 1}, model='cstr',
                    normalise_a=True, normalise_o=True, noise=True, noise_percentage=.001,
                    integration_method='casadi', custom_reward=reward(shaped),
                    done_on_cons_vio=False, constraints={'T': [327,321]},
                    cons_type={'T': ['<=','>=']}, r_penalty=False)

    def publish(policy, repetition, x, u):
        trace = Trajectory.parse(dict(policy=policy, episode=repetition,
            seed=spec.seed + 1000 + repetition,
            temperature_kelvin=[float(v) for v in x[1]],
            concentration=[float(v) for v in x[0]],
            coolant_kelvin=[float(v) for v in u[0]]), spec)
        emit(trace)
        progress(dict(phase='evaluation', policy=policy, episodes=repetition+1, total=spec.episodes))

    for index, policy in enumerate(('base', 'shaped')):
        checkpoint()
        training = make_env(deepcopy(parameters(policy == 'shaped')))
        progress(dict(phase='training', policy=policy, steps=0, total=spec.training_steps))
        try:
            agent = DDPG('MlpPolicy', training, learning_rate=.001, seed=spec.seed + index,
                         device='cpu', verbose=0)
            agent.learn(total_timesteps=spec.training_steps, callback=Progress(policy))
            for repetition in range(spec.episodes):
                checkpoint()
                seed = spec.seed + 1000 + repetition
                np.random.seed(seed)
                evaluation = make_env(deepcopy(parameters(policy == 'shaped')))
                try:
                    observation, _ = evaluation.reset(seed=seed)
                    states, actions = [], []
                    for step in range(spec.samples_per_episode):
                        checkpoint()
                        physical = (np.asarray(observation) + 1) * np.array([.3,50,.1]) / 2 + np.array([.7,300,.8])
                        action, _ = agent.predict(observation, deterministic=True)
                        states.append(physical[:2]); actions.append((np.asarray(action)+1)*10+290)
                        if step < spec.samples_per_episode - 1:
                            observation, _, terminated, truncated, _ = evaluation.step(action)
                            if (terminated or truncated) and step != spec.samples_per_episode - 2:
                                raise ReproductionError('early_termination', 'An episode ended before the frozen sample count')
                    publish(policy, repetition, np.asarray(states).T, np.asarray(actions).T)
                finally:
                    evaluation.close()
        finally:
            training.close()
    if spec.include_oracle:
        for repetition in range(spec.episodes):
            checkpoint()
            np.random.seed(spec.seed + 1000 + repetition)
            baseline = oracle(make_env, deepcopy(parameters(True)), {'N':20})
            x, u = baseline.mpc()
            checkpoint()
            publish('oracle', repetition, x, u)
    spec.require_environment(observe_environment())
