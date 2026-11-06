"""Released-table arithmetic for LCMS2Yield. No files, clock, network, or model calls.

The published 4.74 percentage-point figure is the mean absolute difference of the
released yield columns, multiplied by 100. It is not a yield recomputed from spectra,
and it is not a verdict that a new weight run reproduced the paper.
"""
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_EVEN

COMMIT = '1018ba0ae81259a337e88956b3194d9ebacd71ef'
UPSTREAM = 'https://github.com/xtalpi-inc/lcms2yield'
PAPER = '10.1021/jacsau.6c00812'
REACTION_SHA256 = 'c742ac9dae1a83d4169d00d4cfbc59fc3d2fc1b793798132ebbf52e5f1253826'
WEIGHT_SHA256 = '5c4af32852681f5a5b3d3b10d19c923e0baa419494ef2f0a32710e4c0d34e155'
PREDICT_SHA256 = '89bc3c2b032a01f0386418b5f69a70e9bd98514498e495a74855f7651c91fc6c'
# Released filenames, including the upstream Minisci spelling. kind selects the SMILES column.
DATA_TABLES = (
    ('pretrain', 'data/quantum_chemistry/data.csv', 'c633f750660315b5bb13c9a7696c4c263b42f093125a9db8d376cd5563e8145c', 'smiles'),
    ('fine_tuning', 'data/experiment/Fine_tuning.csv', '3cd469838e7cb7ba81b57fe30998ae9ef99c7348a411ead79a14c5eb2071db97', 'smiles'),
    ('fda', 'data/experiment/FDA.csv', '3a0c35419087302c1a45dec115db576de15f0c8caf4f774872e4369b8e2390f7', 'smiles'),
    ('reaction_products', 'data/experiment/Reaction.csv', REACTION_SHA256, 'reaction'),
    ('suzuki_isolated', 'data/experiment/Isolated_Yields_Suzuki_34.csv', '5ed196e0ad16a0b0dce811a608ea93e679dcc50d87c894198789766c49ca7607', 'reaction'),
    ('minisci_isolated', 'data/experiment/Isolated_Yields_Minisic_26.csv', 'e08a8164c3e9b74226b12c1fdcd9f30c8ba61f890557d2d6c61a2697ab25f8e6', 'reaction'),
)
POPULATION = 178
REPORTED_MAE_PP = Decimal('4.74')
CF_ABSOLUTE_TOLERANCE = Decimal('0.0001')
METHOD = 'lcms2yield.inference'
TYPES = ('Buchwald', 'SN2', 'amide_coupling', 'Suzuki')
COLUMNS = ('RXN Smiles', 'Reaction_Type', 'Exp_Name', 'Yield (Exp)', 'Yield (Pred)', 'CF (Exp)', 'CF (Pred)')


class Invalid(ValueError):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _decimal(value, name):
    if not isinstance(value, str) or not value or any(c.isspace() for c in value):
        raise Invalid('number', f'{name} must be a finite decimal string')
    try:
        number = Decimal(value)
    except Exception as error:
        raise Invalid('number', f'{name} must be a finite decimal string') from error
    if not number.is_finite():
        raise Invalid('number', f'{name} must be a finite decimal string')
    return number


def product_smiles(reaction):
    parts = reaction.split('>>')
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise Invalid('reaction', 'A reaction row needs one reactant>>product SMILES')
    return parts[1]


@dataclass(frozen=True)
class ReactionRow:
    index: int
    reaction_type: str
    name: str
    product_smiles: str
    yield_exp: str
    yield_pred: str
    cf_exp: str
    cf_pred: str

    @classmethod
    def parse(cls, index, raw):
        if not isinstance(raw, dict) or any(name not in raw for name in COLUMNS):
            raise Invalid('schema', 'Reaction row is missing a released column')
        kind = raw['Reaction_Type']
        if kind not in TYPES:
            raise Invalid('population', f'Unexpected reaction type {kind!r}')
        for name in ('Yield (Exp)', 'Yield (Pred)', 'CF (Exp)', 'CF (Pred)'):
            _decimal(raw[name], name)
        name = raw['Exp_Name']
        if not isinstance(name, str) or not name:
            raise Invalid('schema', 'Reaction row needs its experiment name')
        return cls(index, kind, name, product_smiles(raw['RXN Smiles']),
                   raw['Yield (Exp)'], raw['Yield (Pred)'], raw['CF (Exp)'], raw['CF (Pred)'])


def yield_mae_percentage_points(rows):
    """Mean |experimental − predicted| yield, in percentage points, over every row."""
    if not rows:
        raise Invalid('population', 'The yield table is empty')
    total = sum(abs(_decimal(row.yield_exp, 'Yield (Exp)') - _decimal(row.yield_pred, 'Yield (Pred)')) for row in rows)
    return (total / Decimal(len(rows))) * Decimal(100)


def yield_table_verdict(rows):
    mae = yield_mae_percentage_points(rows)
    rounded = mae.quantize(Decimal('0.01'), rounding=ROUND_HALF_EVEN)
    if len(rows) == POPULATION and rounded == REPORTED_MAE_PP:
        return 'PASS', mae
    return 'FAIL', mae


def cf_agreement(published, rerun):
    """Compare a new correction-factor run with the released prediction column.

    The tolerance is absolute and was fixed before any local rerun. A match does
    not recompute reaction yield from chromatograms.
    """
    if len(published) != len(rerun) or len(published) != POPULATION:
        return 'FAIL'
    for left, right in zip(published, rerun):
        if abs(_decimal(left, 'CF (Pred)') - _decimal(right, 'rerun CF')) > CF_ABSOLUTE_TOLERANCE:
            return 'FAIL'
    return 'PASS'


def unique_products(rows):
    return len({row.product_smiles for row in rows})


def type_counts(rows):
    return {kind: sum(row.reaction_type == kind for row in rows) for kind in TYPES}
