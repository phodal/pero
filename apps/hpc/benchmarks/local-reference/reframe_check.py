"""Fixed local ReFrame check; no scheduler selection or job submission here."""
import json
import os
from pathlib import Path
import shlex
import sys

import reframe as rfm
import reframe.utility.sanity as sn
from reframe.core.builtins import run_before, sanity_function


@rfm.simple_test
class PeroNumericalReference(rfm.RunOnlyRegressionTest):
    descr = "Single-process CPU numerical reference; not Slurm, MPI or a performance claim"
    valid_systems = ["*"]
    valid_prog_environs = ["builtin"]
    sourcesdir = None
    num_tasks = 1
    time_limit = "2m"
    executable = sys.executable

    @run_before("run")
    def bind_bundle(self):
        if self.current_partition.scheduler.registered_name != "local":
            raise ValueError("The local reference check requires scheduler=local")
        root = Path(os.environ["PERO_HPC_RUN_DIR"]).resolve()
        if not root.is_dir():
            raise ValueError("Prepare the result bundle before running ReFrame")
        self.executable_opts = [shlex.quote(str(root / "compute.py")), shlex.quote(str(root))]
        verifier = " ".join(shlex.quote(value) for value in
                            (sys.executable, str(root / "verify.py"), str(root), "--write"))
        self.postrun_cmds = [f"{verifier} > {shlex.quote(str(root / 'checker.log'))}"]
        self.keep_files = []
        (root / "runner.json").write_text(json.dumps({
            "name": "ReFrame", "version": rfm.VERSION, "scheduler": "local",
            "partition": self.current_partition.fullname, "ranks": 1,
            "python": sys.executable}, indent=2) + "\n")
        self._bundle = root

    @sanity_function
    def independently_verified(self):
        return sn.assert_found(r'"status": "pass"', str(self._bundle / "verification.json"))
