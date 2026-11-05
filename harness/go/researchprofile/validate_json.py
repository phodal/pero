#!/usr/bin/env python3
"""Reject empty/missing selections, then execute the unchanged upstream validator."""
import argparse
import runpy
import sys
from pathlib import Path

parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--fields", "-f")
parser.add_argument("--json", "-j", nargs="*")
parser.add_argument("--dir", "-d", default="results")
args, _ = parser.parse_known_args()
if args.fields is not None and not Path(args.fields).is_file():
    print("[错误] 显式选择的字段定义文件必须实际存在；不能回退到其他 fields.yaml。", file=sys.stderr)
    sys.exit(1)
selected = ([Path(value) for value in args.json] if args.json is not None
            else sorted(Path(args.dir).glob("*.json")))
if not selected or any(not path.is_file() for path in selected):
    print("[错误] 必须选择至少一个实际存在的 JSON 结果；空集合或缺失文件不能视为验证通过。", file=sys.stderr)
    sys.exit(1)
runpy.run_path(str(Path(__file__).with_name("validate_json.upstream.py")), run_name="__main__")
