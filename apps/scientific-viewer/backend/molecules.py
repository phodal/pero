"""Bounded molecule inputs and deterministic RDKit result projection."""
from dataclasses import dataclass
import math

MAX_REQUEST = 1024 * 1024
MAX_OUTPUT = 4 * 1024 * 1024
MAX_RECORD = 32 * 1024


@dataclass(frozen=True)
class MoleculeRequest:
    format: str
    records: tuple[str, ...]

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) != {'format', 'records'}:
            raise ValueError('Expected format and records only')
        kind, records = value['format'], value['records']
        if kind not in ('smiles', 'mol', 'sdf') or not isinstance(kind, str):
            raise ValueError('Choose smiles, mol or sdf format')
        if not isinstance(records, list) or not 1 <= len(records) <= 200:
            raise ValueError('Provide 1 to 200 molecule records')
        for record in records:
            if not isinstance(record, str) or not record.strip() or len(record.encode('utf-8')) > MAX_RECORD:
                raise ValueError('Each molecule must be nonempty and at most 32 KiB')
        return cls(kind, tuple(records))


@dataclass(frozen=True)
class MoleculeRow:
    input: str
    svg: str | None = None
    descriptors: tuple[tuple[str, float], ...] = ()
    error: str | None = None

    def wire(self):
        if self.error:
            return {'input': self.input, 'error': self.error}
        return {'input': self.input, 'svg': self.svg, 'descriptors': dict(self.descriptors)}


def preview(request: MoleculeRequest):
    from rdkit import Chem, rdBase
    from rdkit.Chem import Descriptors, rdMolDescriptors, rdDepictor
    from rdkit.Chem.Draw import rdMolDraw2D
    metrics = (
        ('MolWt', Descriptors.MolWt), ('ExactMolWt', rdMolDescriptors.CalcExactMolWt),
        ('MolLogP', Descriptors.MolLogP), ('TPSA', rdMolDescriptors.CalcTPSA),
        ('NumHDonors', rdMolDescriptors.CalcNumHBD), ('NumHAcceptors', rdMolDescriptors.CalcNumHBA),
        ('NumRotatableBonds', rdMolDescriptors.CalcNumRotatableBonds),
    )
    rows = []
    for text in request.records:
        try:
            # Input stays data: no file paths, Python execution, pickle or URLs.
            if request.format == 'smiles':
                params = Chem.SmilesParserParams()
                params.parseName = False
                params.allowCXSMILES = False
                mol = Chem.MolFromSmiles(text, params)
            else:
                block = text.split('$$$$')[0] if request.format == 'sdf' else text
                mol = Chem.MolFromMolBlock(block, sanitize=True, removeHs=True, strictParsing=True)
            if mol is None or not mol.GetNumAtoms():
                raise ValueError('Invalid molecule')
            if mol.GetNumAtoms() > 512 or mol.GetNumBonds() > 1024:
                raise ValueError('Molecule exceeds 512 atoms or 1,024 bonds')
            values = tuple((name, float(function(mol))) for name, function in metrics)
            if not all(math.isfinite(value) for _, value in values):
                raise ValueError('Descriptor calculation returned a nonfinite value')
            rdDepictor.Compute2DCoords(mol)
            drawer = rdMolDraw2D.MolDraw2DSVG(360, 260)
            drawer.DrawMolecule(mol)
            drawer.FinishDrawing()
            svg = drawer.GetDrawingText()
            if len(svg.encode('utf-8')) > 256 * 1024:
                raise ValueError('Molecule drawing exceeds 256 KiB')
            rows.append(MoleculeRow(text, svg, values))
        except (ValueError, RuntimeError, OverflowError) as error:
            rows.append(MoleculeRow(text, error=str(error)[:300]))
    return {'engine': {'name': 'RDKit', 'version': rdBase.rdkitVersion}, 'rows': [row.wire() for row in rows]}
