"""One published statistic, not a generic executor or a whole-paper verdict.

Fisher (1936), Table III: within-species sepal-length sum of squares, cm².
The data are a visual transcription of Table I, not OCR or sklearn/UCI data.
"""
import csv
from dataclasses import asdict, dataclass
import hashlib
import io
import math
import re

from .pcgym_domain import Invalid, digest
from .verification import ComparisonPolicy

CASE = 'fisher-1936-table3-sepal-length-v1'
DOI = '10.1111/j.1469-1809.1936.tb02137.x'
PDF_URL = 'https://lgross.utk.edu/Math589Fall2020/RAFisher1936measurementsFlowerTaxa.pdf'
PDF_SHA256 = 'd3a49aaa4f2d283931544f58cb12b1174f537642b83def7ae9119a1d8717b740'
DATA_SHA256 = '63bc335cdbbecc311a3dced4a28b210a94bc2ccc71b0df5535b72c30091623fc'
METRIC = 'sum_species sum_rows (sepal_length_cm - species_mean_cm)^2'
UNIT = 'cm^2'
REPORTED = 19.1434
DEFAULT_TOLERANCE = .00005  # Half the printed fourth decimal, fixed before runs.
# Visually inspected on the pinned scan, PDF page 4 / printed page 181.
# The first Table III number has no usable text-layer token; use a true region.
RESULT_RECT = dict(x=.34, y=.339, width=.065, height=.012)


@dataclass(frozen=True)
class SepalObservation:
    species: str
    row: int
    length_cm: float


def observations(data):
    """Validate once at the data boundary, before any numerical calculation."""
    if hashlib.sha256(data).hexdigest() != DATA_SHA256:
        raise Invalid('data_version', 'Data differ from the reviewed Table I transcription')
    reader = csv.DictReader(io.StringIO(data.decode('ascii')))
    if reader.fieldnames != ['species', 'row', 'sepal_length_cm']:
        raise Invalid('data_schema', 'Expected species, row and sepal_length_cm')
    parsed = []
    for index, row in enumerate(reader):
        species = 'setosa' if index < 50 else 'versicolor'
        number = index % 50 + 1
        value = row.get('sepal_length_cm', '')
        if (index >= 100 or row.get('species') != species or row.get('row') != str(number)
                or not re.fullmatch(r'[0-9]\.[0-9]', value)):
            raise Invalid('data_coverage', 'Require all 50 ordered observations for each species')
        parsed.append(SepalObservation(species, number, float(value)))
    if len(parsed) != 100:
        raise Invalid('data_coverage', 'Require all 100 Table I observations')
    return tuple(parsed)


@dataclass(frozen=True)
class SpeciesStatistic:
    species: str
    count: int
    mean_cm: float
    centered_sum_squares_cm2: float


@dataclass(frozen=True)
class FisherResult:
    species: tuple[SpeciesStatistic, ...]
    actual: float

    @classmethod
    def compute(cls, rows):
        groups = []
        for species in ('setosa', 'versicolor'):
            values = [row.length_cm for row in rows if row.species == species]
            mean = math.fsum(values) / len(values)
            groups.append(SpeciesStatistic(species, len(values), mean,
                math.fsum((value - mean) ** 2 for value in values)))
        return cls(tuple(groups), math.fsum(group.centered_sum_squares_cm2 for group in groups))

    def to_dict(self):
        return dict(case=CASE, metric=METRIC, unit=UNIT, measurement_grain='two-species-within-group',
                    count=100, degrees_of_freedom=98, variance_divisor=None,
                    species=[asdict(row) for row in self.species], actual=self.actual)


@dataclass(frozen=True)
class FisherProtocol:
    selection_digest: str
    pipeline_digest: str
    python_version: str
    interpreter_digest: str
    comparison: ComparisonPolicy

    def payload(self):
        return dict(case=CASE, doi=DOI, pdf_sha256=PDF_SHA256, data_sha256=DATA_SHA256,
            data_location='Table I, PDF page 3 / printed page 180; sepal length only',
            result_location='Table III, PDF page 4 / printed page 181; row 1, column 1',
            metric=METRIC, unit=UNIT, reported=REPORTED, count=100, groups=2,
            selection_digest=self.selection_digest, pipeline_digest=self.pipeline_digest,
            python_version=self.python_version, interpreter_digest=self.interpreter_digest,
            comparison=self.comparison.to_dict(),
            command=['python', '-m', 'paper_agent.fisher_reproduction', 'run', '--bundle',
                     '<bundle>', '--spec-sha', '<spec-id>', '--confirm-execution'],
            scope='Numerical reanalysis of one published statistic; not a whole-paper reproduction')

    @property
    def id(self):
        return digest(self.payload())

    def to_dict(self):
        return dict(id=self.id, **self.payload())

    @classmethod
    def parse(cls, raw):
        try:
            protocol = cls(raw['selection_digest'], raw['pipeline_digest'], raw['python_version'],
                           raw['interpreter_digest'], ComparisonPolicy.parse(raw['comparison']))
        except (KeyError, TypeError) as error:
            raise Invalid('protocol', 'Incomplete Fisher protocol') from error
        if raw != protocol.to_dict():
            raise Invalid('protocol', 'Frozen case, input, metric, command or identity changed')
        return protocol

    def compare(self, actual, independent):
        if not independent:
            return dict(comparison_status='inconclusive', result_verdict='INCONCLUSIVE',
                        paper_verdict='NOT_ASSESSED', reported=REPORTED, actual=actual,
                        reason='Independent numerical verification is required')
        diagnostic = self.comparison.assess(REPORTED, actual)
        status = diagnostic.pop('status')
        return dict(comparison_status=status,
                    result_verdict={'within_tolerance': 'REPRODUCED', 'outside_tolerance': 'MISMATCH',
                                    'undefined': 'INCONCLUSIVE'}[status],
                    paper_verdict='NOT_ASSESSED', reported=REPORTED, actual=actual, **diagnostic)
