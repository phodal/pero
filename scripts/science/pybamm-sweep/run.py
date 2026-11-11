"""Execute only the fixed CPU method; no queue, retry, provider or scheduler."""
import argparse
from dataclasses import asdict
from importlib.metadata import version
import json
import os
from pathlib import Path
import platform
import time

from contract import Environment, Result, encoded
from bundle import load_identity


def calculate(experiment_id: str) -> Result:
    identity = load_identity()
    method = identity.method
    experiment = method.experiment(experiment_id)
    packages = tuple((name, version(name)) for name, _ in identity.environment.packages)
    environment = Environment(platform.python_version(), packages)
    if environment != identity.environment:
        raise ValueError('Environment differs from requirements.lock / pinned Python; no solve started')
    os.environ['PYBAMM_DISABLE_TELEMETRY'] = 'true'
    for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
        os.environ[key] = '1'
    import numpy as np
    import pybamm

    started = time.monotonic()
    parameters = pybamm.ParameterValues(method.parameter_set)
    if parameters['Nominal cell capacity [A.h]'] != method.capacity_ah:
        raise ValueError('Parameter-set capacity differs from frozen method')
    parameters.update({'Current function [A]': method.capacity_ah * experiment.c_rate,
                       'Ambient temperature [K]': experiment.temperature_k,
                       'Initial temperature [K]': experiment.temperature_k})
    simulation = pybamm.Simulation(
        pybamm.lithium_ion.DFN(options={'thermal': method.thermal}),
        parameter_values=parameters,
        var_pts={key: method.mesh_points for key in ('x_n', 'x_s', 'x_p', 'r_n', 'r_p')},
        solver=pybamm.IDAKLUSolver(rtol=method.solver_rtol, atol=method.solver_atol))
    times = np.array(method.times)
    solution = simulation.solve([0, method.duration_s], t_interp=times, initial_soc=method.initial_soc)
    return Result(experiment, method.method_id, identity.sha256, environment,
                  platform.node(), platform.system(), platform.machine(), time.monotonic() - started,
                  solution.termination, method.times,
                  tuple(solution['Terminal voltage [V]'](times).tolist()),
                  tuple(solution['Current [A]'](times).tolist()),
                  tuple(solution['Discharge capacity [A.h]'](times).tolist()))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    method = load_identity().method
    parser.add_argument('experiment', choices=[e.id for e in method.experiments] + ['reference'])
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    # Exclusive output prevents an accidental overwrite of a frozen reference/attempt.
    with args.output.open('x') as stream:
        identities = [e.id for e in method.experiments] if args.experiment == 'reference' else [args.experiment]
        for identity in identities:
            result = calculate(identity)
            stream.write(encoded(asdict(result)).decode() + '\n')
            stream.flush()
            print(json.dumps({'experiment': identity, 'elapsed_s': result.elapsed_s,
                              'termination': result.termination, 'voltage_end_v': result.voltage_v[-1]}), flush=True)
