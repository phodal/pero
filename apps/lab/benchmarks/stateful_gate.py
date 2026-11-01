"""Constructed software ablation motivated by VERID §2.2, not its benchmark data.

Static: the real IR grammar + frozen version/revision/step envelope, no state fold.
Stateful: exactly the same checks followed by Lab's actual resource transition fold.
No hardware, random generator, model call, or new execution implementation exists.
"""
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from domain import Invalid, initial_state, parse_protocol, parse_state, validate_protocol, validate_protocol_envelope

SOURCE = {
    'title': 'Semantic Representation for Agentic Self-Play in Automated Laboratories',
    'paper': 'arXiv:2610.32755v1',
    'url': 'https://www.gstatic.com/science-ai/verid_semantic_lab.pdf',
    'pdf_sha256': 'b047f7609e237ca371e42fac76fe77e454cdf6bba5436388499a28ccb3f7783c',
    'sections': ['2.2 (pp. 3–4)', '6.2 (pp. 12–13)'],
}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(value): return hashlib.sha256(canonical(value)).hexdigest()


@dataclass(frozen=True)
class Case:
    id: str
    steps: tuple[dict, ...]
    expected_code: str | None
    expected_step: int | None
    rationale: str
    schema_control: bool = False

    def protocol(self): return {'version': 1, 'initial_revision': 0, 'steps': list(self.steps)}


def op(name, resource, volume=None):
    return {'op': name, 'resource': resource, **({'volume_ul': volume} if volume is not None else {})}


PICK = op('pickup_tip', 'T1')
CASES = (
    Case('legal_transfer', (PICK, op('aspirate','A1',50), op('dispense','B1',50), op('return_tip','T1')),
         None, None, 'A valid single-use-tip transfer is the positive control.'),
    Case('missing_tip', (op('aspirate','A1',50),), 'missing_tip', 0, 'No tip was acquired.'),
    Case('empty_source', (PICK, op('aspirate','B1',1)), 'depletion', 1, 'B1 starts empty.'),
    Case('cumulative_source_depletion', (PICK, op('aspirate','A1',150), op('dispense','B1',150), op('aspirate','A1',51)),
         'depletion', 3, 'A1 starts with 200 µL; only 50 remains after the first aspiration.'),
    Case('cumulative_pipette_capacity', (PICK, op('aspirate','A1',200), op('aspirate','A2',101)),
         'pipette_capacity', 2, 'Each aspiration is in range, but together exceeds the 300 µL pipette.'),
    Case('destination_overflow', (PICK, op('aspirate','A1',101), op('dispense','A2',101)),
         'well_capacity', 2, 'A2 already holds 200 µL and cannot hold 301 µL.'),
    Case('consumed_tip_reuse', (PICK, op('return_tip','T1'), PICK),
         'tip_unavailable', 2, 'Lab-specific single-use policy: returning a tip does not renew it.'),
    Case('return_loaded_tip', (PICK, op('aspirate','A1',1), op('return_tip','T1')),
         'tip_not_empty', 2, 'Lab-specific return policy requires an empty tip.'),
    Case('dispense_exceeds_held', (PICK, op('aspirate','A1',10), op('dispense','B1',11)),
         'pipette_depletion', 2, 'Dispense requests more than the acquired liquid.'),
    Case('malformed_quantity_control', (PICK, op('aspirate','A1',0)),
         'quantity', 1, 'Both baselines must reject nonpositive IR quantities.', True),
)


def verdict(case, state, stateful):
    try:
        protocol = parse_protocol(case.protocol())
        validate_protocol_envelope(protocol, state.revision, 64)
        snapshots = validate_protocol(state, protocol, 64) if stateful else ()
        return {'accepted': True, 'code': None, 'step_index': None,
                'final_state_sha256': sha(snapshots[-1].to_dict()) if snapshots else None}
    except Invalid as error:
        return {'accepted': False, 'code': error.code, 'step_index': error.step_index,
                'final_state_sha256': None}


def confusion(rows, name):
    # Positive means resource-invalid, not "successful execution".
    tp = fp = tn = fn = 0
    for row in rows:
        invalid, rejected = row['expected_code'] is not None, not row[name]['accepted']
        if invalid and rejected: tp += 1
        elif invalid: fn += 1
        elif rejected: fp += 1
        else: tn += 1
    return {'true_positive':tp,'false_positive':fp,'true_negative':tn,'false_negative':fn,
            'invalid_recall':tp/(tp+fn) if tp+fn else None,
            'rejection_precision':tp/(tp+fp) if tp+fp else None}


def run():
    state = initial_state()
    initial_hash = sha(state.to_dict())
    rows=[]
    for case in CASES:
        static = verdict(case,state,False); stateful = verdict(case,state,True)
        restored = verdict(case,parse_state(json.loads(canonical(state.to_dict()))),True)
        rows.append({'id':case.id,'protocol':case.protocol(),'protocol_sha256':sha(case.protocol()),
                     'expected_code':case.expected_code,'expected_step_index':case.expected_step,
                     'rationale':case.rationale,'schema_control':case.schema_control,
                     'static':static,'stateful':stateful,'snapshot_roundtrip_equivalent':restored==stateful,
                     'initial_state_unchanged':sha(state.to_dict())==initial_hash})
    resource_rows=[row for row in rows if not row['schema_control']]
    return {'schema_version':1,'benchmark':'lab-constructed-stateful-gate-v1','source':SOURCE,
            'origin':'locally constructed deterministic fixtures, not Google benchmark data',
            'scope':'Structural software ablation only; no wet-lab, model, geometry or scientific accuracy reproduction.',
            'positive_class':'resource-invalid protocol',
            'initial_state':state.to_dict(),'initial_state_sha256':initial_hash,
            'case_set_sha256':sha([{'id':c.id,'protocol':c.protocol(),'expected_code':c.expected_code,'expected_step':c.expected_step} for c in CASES]),
            'resource_case_count':len(resource_rows),'schema_control_count':len(rows)-len(resource_rows),
            'metrics':{name:confusion(resource_rows,name) for name in ('static','stateful')},'cases':rows,
            'limitations':['Labels and cases were authored here, not sampled from Google experiments.',
                           'A tiny constructed suite is not an estimate of general safety or failure detection.',
                           'Single-use tip and empty-return constraints are Lab policy, not claimed VERID rules.',
                           'Snapshot round-trip equality is not physical fault recovery.',
                           'No claim to reproduce the paper’s reported 307 or 58 mnat physical outcomes.']}


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    result=run(); args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps({'report':str(args.output),'metrics':result['metrics'],'case_set_sha256':result['case_set_sha256']}))
