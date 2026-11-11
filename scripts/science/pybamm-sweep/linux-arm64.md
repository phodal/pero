# Pinned solver build on Ubuntu 24.04 ARM64

The verified Python runtime remains 3.12.11 with the unchanged `requirements.lock`:
PyBaMM 25.10.2, NumPy 2.2.6, SciPy 1.15.3, CasADi 3.6.7 and pybammsolvers 0.3.3.
The 0.3.3 PyPI release has no matching Linux ARM64 wheel; its sdist lacks the root
CMakeLists.txt. Build the [official v0.3.3 source](https://github.com/pybamm-team/pybammsolvers/tree/v0.3.3)
instead. Its hard-coded old C++ string ABI conflicts with this ARM64 CasADi wheel
(`Function::deserialize` undefined symbol). The one-line build adjustment below
selects ABI 1. No numerical source, model setting, tolerance or lock version changes.
This produces a locally built wheel, not an unmodified upstream binary.

Run inside the authorized VM, with `uv` installed. Set `checkout` to the read-only
mount of this checkout. Build dependencies live in a separate environment.

```sh
checkout=/absolute/path/to/pero
build_root="$HOME/pybamm59"
mkdir -p "$build_root"
sudo apt-get update
sudo apt-get install -y build-essential pkg-config ca-certificates libopenblas-dev gfortran iptables
uv venv --python 3.12.11 "$build_root/venv"
uv venv --python 3.12.11 "$build_root/build-env"
uv pip install --python "$build_root/build-env/bin/python" \
  cmake==4.4.4 casadi==3.6.7 numpy==2.5.4 packaging==26.3 \
  pybind11==3.1.0 pybind11-global==3.1.0 setuptools==84.2.1 wheel==0.48.0
git clone --depth 1 --branch v0.3.3 https://github.com/pybamm-team/pybammsolvers.git "$build_root/solver-source"
cd "$build_root/solver-source"
test "$(git rev-parse HEAD)" = 6e0c9286e65a29b35ac9941951e738ddb58e1d5a
git -c url.https://github.com/.insteadOf=git@github.com: submodule update --init --depth 1
sed -i s/_GLIBCXX_USE_CXX11_ABI=0/_GLIBCXX_USE_CXX11_ABI=1/ CMakeLists.txt
PATH="$build_root/build-env/bin:$PATH" python install_KLU_Sundials.py
PATH="$build_root/build-env/bin:$PATH" CMAKE_BUILD_PARALLEL_LEVEL=1 \
  uv build --wheel --no-build-isolation --python "$build_root/build-env/bin/python" --out-dir "$build_root/wheels" .
uv pip sync --python "$build_root/venv/bin/python" --find-links "$build_root/wheels" \
  "$checkout/scripts/science/pybamm-sweep/requirements.lock"
LD_LIBRARY_PATH="$build_root/solver-source/.idaklu/lib" "$build_root/venv/bin/python" \
  "$checkout/scripts/science/pybamm-sweep/run.py" c05-t298 "$build_root/new-preflight.jsonl"
git diff -- CMakeLists.txt
git submodule status
sha256sum "$build_root/wheels/"*.whl
```

Retain `.idaklu/lib` and set `LD_LIBRARY_PATH` on the allowlisted Agent. This
wheel is not repaired into a portable binary. CasADi's CMake config also supplies
ABI 0; the final ABI 1 definition produces a compiler redefinition warning.
The resulting extension imported and all three Linux calculations matched the
frozen macOS reference. Installed runtime versions are checked before each solve.

Observed build identity on 2026-11-11:

| Component | SHA / commit |
| --- | --- |
| pybammsolvers v0.3.3 source | `6e0c9286e65a29b35ac9941951e738ddb58e1d5a` |
| SuiteSparse submodule | `d3c4926d2c47fd6ae558e898bfc072ade210a2a1` |
| SUNDIALS submodule | `e941546af1a5b5e492dcac0a1872540e9961c556` |
| Built cp312 Linux aarch64 wheel SHA-256 | `319005090b1b6e0c1c2bfbaad49dc8b768bd6be47ef330c1dd8ce241ae7a4730` |

The wheel hash identifies the observed artifact, not a reproducible-build promise.
The source-built Linux Worker used repository base `5072cbc6`; Cargo resolved only
the unused GPUI macros package from 0.9.0 to 0.9.1. Its lock/build log are retained
in the acceptance evidence; Worker dependency versions did not change.
