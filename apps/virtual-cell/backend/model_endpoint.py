"""The App backend's reusable additive model; Host owns its HTTP process.

Only a frozen training view is retained. This is an empirical CPU baseline,
not a pretrained biological model. Remote deployments use this same narrow
contract; their inputs must be explicitly provisioned before connection.
"""
from dataclasses import dataclass, replace
import json
import os
import threading
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from baselines import BASELINE_VERSION, check_predictions, run_baseline
from contract import Invalid, canonical, sealed
from dataset import training_view
from evaluation import test_queries

MODEL = {"id": "additive-endpoint", "version": BASELINE_VERSION}


@dataclass(frozen=True)
class ModelState:
    status: str = "stopped"
    input_id: str | None = None
    uses: int = 0
    error: str | None = None

    def begin(self, input_id):
        if self.status in ("starting", "in_use", "stopping"):
            raise Invalid("model_endpoint_busy")
        return ModelState("starting", input_id)

    def ready(self):
        if self.status not in ("starting", "in_use"):
            raise Invalid("model_endpoint_transition")
        return replace(self, status="ready")

    def use(self, input_id):
        if self.status != "ready" or self.input_id != input_id:
            raise Invalid("model_endpoint_input_not_ready")
        return replace(self, status="in_use", uses=self.uses + 1)

    def stop(self):
        if self.status in ("starting", "in_use"):
            raise Invalid("model_endpoint_busy")
        return replace(self, status="stopping")

    def stopped(self):
        if self.status != "stopping":
            raise Invalid("model_endpoint_transition")
        return ModelState()

    def failed(self, error):
        if self.status not in ("starting", "in_use"):
            raise Invalid("model_endpoint_transition")
        return replace(self, status="failed", error=error)


class AdditiveEndpoint:
    def __init__(self, workbench, remote_url=None, remote_token=None):
        self.workbench, self.lock = workbench, threading.RLock()
        self.remote_url = remote_url
        self.remote_token = remote_token
        if remote_url:
            parsed = urlsplit(remote_url)
            if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise Invalid("model_endpoint_url_invalid")
            self.remote_url = remote_url.rstrip("/")
        self.state = ModelState()
        self.inputs, self.train, self.queries = None, None, None

    @classmethod
    def configured(cls, workbench):
        return cls(workbench, os.environ.get("PERO_VIRTUAL_CELL_MODEL_URL"),
                   os.environ.get("PERO_VIRTUAL_CELL_MODEL_TOKEN"))

    def read(self):
        with self.lock:
            return {"status": self.state.status, "inputId": self.state.input_id,
                    "model": MODEL, "source": "remote" if self.remote_url else "local",
                    "uses": self.state.uses, "error": self.state.error}

    def _remote(self, path, body=None):
        headers = {"Content-Type": "application/json"}
        if self.remote_token:
            headers["X-Pero-App-Token"] = self.remote_token
        request = Request(self.remote_url + path, data=canonical(body) if body is not None else None, headers=headers)
        with urlopen(request, timeout=30) as response:
            raw = response.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise Invalid("model_endpoint_response_too_large")
        document = json.loads(raw)
        if not isinstance(document, dict):
            raise Invalid("model_endpoint_response_invalid")
        return document

    def start(self, input_id):
        with self.lock:
            if self.state.status == "ready" and self.state.input_id == input_id:
                return self.read()
            self.state = self.state.begin(input_id)
        try:
            inputs = self.workbench.comparison_inputs(input_id)
            if self.remote_url:
                report = self._remote("/api/model")
                if report.get("status") != "ready" or report.get("inputId") != input_id or report.get("model") != MODEL:
                    raise Invalid("remote_model_not_ready", "Provision the same frozen input and start the remote additive endpoint first")
                train, queries = None, None
            else:
                train, queries = training_view(inputs.dataset, inputs.split), test_queries(inputs.dataset, inputs.split)
            with self.lock:
                self.inputs, self.train, self.queries = inputs, train, queries
                self.state = self.state.ready()
        except (Invalid, OSError, ValueError) as error:
            with self.lock:
                self.state = self.state.failed(str(error))
            raise
        return self.read()

    def stop(self):
        with self.lock:
            self.state = self.state.stop()
            self.inputs, self.train, self.queries = None, None, None
            self.state = self.state.stopped()
            return self.read()

    def predict(self, input_id):
        with self.lock:
            self.state = self.state.use(input_id)
        try:
            if self.remote_url:
                prediction = self._remote("/api/model/predict", {"inputId": input_id})
                check_predictions(prediction)
                if prediction["model"] != {**MODEL, "kind": "empirical_baseline"}:
                    raise Invalid("remote_model_identity_mismatch")
            else:
                prediction = run_baseline("additive", self.inputs.split, self.train, self.queries)
                prediction = sealed({**prediction, "model": {**MODEL, "kind": "empirical_baseline"}})
            with self.lock:
                self.state = self.state.ready()
            return prediction
        except (Invalid, OSError, ValueError) as error:
            with self.lock:
                self.state = self.state.failed(str(error))
            raise
