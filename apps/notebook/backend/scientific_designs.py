"""Notebook-local plate design and reaction records. No inventory or chemistry service."""
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
import re
import sqlite3
from uuid import uuid4

from document import block_id, fields, integer, string
from store import RevisionConflict


class MissingScientificRecord(Exception):
    pass


@dataclass(frozen=True)
class ScientificPin:
    id: str
    revision: int

    @classmethod
    def parse(cls, value):
        fields(value, {'id', 'revision'})
        return cls(block_id(value['id']), integer(value['revision'], 'record revision'))

    def wire(self):
        return dict(id=self.id, revision=self.revision)


def bounded_list(value, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f'At most {maximum} items are supported')
    return value


@dataclass(frozen=True)
class ChemicalAtom:
    id: str
    element: str
    x: float
    y: float
    charge: int

    def wire(self):
        return dict(id=self.id, element=self.element, x=self.x, y=self.y, charge=self.charge)


@dataclass(frozen=True)
class ChemicalBond:
    id: str
    start: str
    end: str
    order: int

    def wire(self):
        return {'id': self.id, 'from': self.start, 'to': self.end, 'order': self.order}


@dataclass(frozen=True)
class MolecularGraph:
    atoms: tuple[ChemicalAtom, ...]
    bonds: tuple[ChemicalBond, ...]

    @classmethod
    def parse(cls, value):
        fields(value, {'atoms', 'bonds'})
        atoms, identities = [], set()
        for atom in bounded_list(value['atoms'], 128):
            fields(atom, {'id', 'element', 'x', 'y', 'charge'})
            identity = block_id(atom['id'])
            if identity in identities:
                raise ValueError('Duplicate atom identity')
            identities.add(identity)
            if atom['element'] not in ('H', 'B', 'C', 'N', 'O', 'F', 'Si', 'P', 'S', 'Cl', 'Br', 'I'):
                raise ValueError('Unsupported element')
            for key, maximum in (('x', 600), ('y', 320)):
                if type(atom[key]) not in (int, float) or not math.isfinite(atom[key]) or not 0 <= atom[key] <= maximum:
                    raise ValueError('Atom coordinates lie outside the drawing')
            integer(atom['charge'], 'formal charge', 3, minimum=-3)
            atoms.append(ChemicalAtom(identity, atom['element'], atom['x'], atom['y'], atom['charge']))
        bonds, pairs, bond_ids = [], set(), set()
        for bond in bounded_list(value['bonds'], 256):
            fields(bond, {'id', 'from', 'to', 'order'})
            identity, start, end = block_id(bond['id']), block_id(bond['from']), block_id(bond['to'])
            pair = tuple(sorted((start, end)))
            if identity in bond_ids or pair in pairs or start == end or start not in identities or end not in identities:
                raise ValueError('Bond needs unique identity and distinct existing endpoints; one bond per pair')
            bond_ids.add(identity); pairs.add(pair)
            integer(bond['order'], 'bond order', 3)
            bonds.append(ChemicalBond(identity, start, end, bond['order']))
        return cls(tuple(atoms), tuple(bonds))

    def wire(self):
        return dict(atoms=[atom.wire() for atom in self.atoms], bonds=[bond.wire() for bond in self.bonds])


@dataclass(frozen=True)
class PlateMetadataField:
    key: str
    value: str


@dataclass(frozen=True)
class PlateMetadata:
    barcode: str
    plate_type: str
    well_volume_microliters: float | None
    fields: tuple[PlateMetadataField, ...]

    def wire(self):
        return dict(barcode=self.barcode, plateType=self.plate_type, wellVolumeMicroliters=self.well_volume_microliters,
                    fields=[dict(key=item.key, value=item.value) for item in self.fields])


@dataclass(frozen=True)
class PlateWell:
    name: str
    groups: tuple[str, ...]


@dataclass(frozen=True)
class PlateLayout:
    rows: int
    columns: int
    wells: tuple[PlateWell, ...]

    def wire(self):
        return dict(size=dict(rows=self.rows, columns=self.columns), groups={well.name: list(well.groups) for well in self.wells})


@dataclass(frozen=True)
class PlateDesign:
    name: str
    description: str
    metadata: PlateMetadata
    layout: PlateLayout
    origin: ScientificPin | None

    @classmethod
    def parse(cls, value):
        fields(value, {'name', 'description', 'metadata', 'layout', 'origin'})
        name = string(value['name'], 'plate design name', 200, required=True)
        description = string(value['description'], 'plate description', 2000)
        metadata = fields(value['metadata'], {'barcode', 'plateType', 'wellVolumeMicroliters', 'fields'})
        string(metadata['barcode'], 'plate barcode', 200)
        string(metadata['plateType'], 'plate type', 200)
        volume = metadata['wellVolumeMicroliters']
        if volume is not None and (type(volume) not in (int, float) or not math.isfinite(volume) or not 0 < volume <= 1e6):
            raise ValueError('Well capacity must be a positive finite volume in µL')
        keys, metadata_fields = set(), []
        for field in bounded_list(metadata['fields'], 24):
            fields(field, {'key', 'value'})
            key = string(field['key'], 'metadata key', 64, required=True).strip().lower()
            string(field['value'], 'metadata value', 500)
            if key in keys:
                raise ValueError('Duplicate plate metadata key')
            keys.add(key)
            metadata_fields.append(PlateMetadataField(field['key'], field['value']))
        layout = fields(value['layout'], {'size', 'groups'})
        size = fields(layout['size'], {'rows', 'columns'})
        rows, columns = integer(size['rows'], 'plate rows', 32), integer(size['columns'], 'plate columns', 48)
        if not isinstance(layout['groups'], dict) or len(layout['groups']) > rows * columns:
            raise ValueError('Invalid plate well assignments')
        wells = []
        for well, groups in layout['groups'].items():
            match = re.fullmatch(r'([A-Z]{1,2})([1-9][0-9]*)', well)
            row = 0
            if match:
                for letter in match[1]:
                    row = row * 26 + ord(letter) - 64
            if match is None or row > rows or int(match[2]) > columns:
                raise ValueError('Well lies outside the plate')
            bounded_list(groups, 12)
            for group in groups:
                string(group, 'well group', 64, required=True)
            if not groups or len(set(groups)) != len(groups):
                raise ValueError('Well groups must be nonempty and distinct')
            wells.append(PlateWell(well, tuple(groups)))
        return cls(name, description,
                   PlateMetadata(metadata['barcode'], metadata['plateType'], volume, tuple(metadata_fields)),
                   PlateLayout(rows, columns, tuple(wells)), None if value['origin'] is None else ScientificPin.parse(value['origin']))

    def wire(self):
        return dict(name=self.name, description=self.description, metadata=self.metadata.wire(), layout=self.layout.wire(),
                    origin=None if self.origin is None else self.origin.wire())


@dataclass(frozen=True)
class ReactionMolecule:
    id: str
    name: str
    role: str
    graph: MolecularGraph

    def wire(self):
        return dict(id=self.id, name=self.name, role=self.role, graph=self.graph.wire())


@dataclass(frozen=True)
class ReactionDefinition:
    name: str
    notes: str
    molecules: tuple[ReactionMolecule, ...]

    @classmethod
    def parse(cls, value, *, submitted=False):
        fields(value, {'name', 'notes', 'molecules'})
        name = string(value['name'], 'reaction name', 200, required=submitted)
        notes = string(value['notes'], 'reaction notes', 4000)
        molecules, identities = [], set()
        for molecule in bounded_list(value['molecules'], 24):
            fields(molecule, {'id', 'name', 'role', 'graph'})
            identity = block_id(molecule['id'])
            if identity in identities:
                raise ValueError('Duplicate molecule identity')
            identities.add(identity)
            string(molecule['name'], 'molecule name', 200, required=submitted)
            if molecule['role'] not in ('reactant', 'product', 'agent'):
                raise ValueError('Invalid molecule role')
            graph = MolecularGraph.parse(molecule['graph'])
            if submitted and not graph.atoms:
                raise ValueError('Draw atoms in every submitted molecule')
            molecules.append(ReactionMolecule(identity, molecule['name'], molecule['role'], graph))
        if submitted and not {'reactant', 'product'} <= {item.role for item in molecules}:
            raise ValueError('A local reaction record needs at least one reactant and one product')
        return cls(name, notes, tuple(molecules))

    def wire(self):
        return dict(name=self.name, notes=self.notes, molecules=[item.wire() for item in self.molecules])


def parse_reaction_record(value):
    fields(value, {'id', 'revision', 'savedAt', 'definition'})
    ScientificPin.parse(dict(id=value['id'], revision=value['revision']))
    timestamp = string(value['savedAt'], 'saved timestamp', 80, required=True)
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})', timestamp):
        raise ValueError('Invalid saved record timestamp')
    try:
        parsed = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('Timestamp needs a time zone')
    except ValueError as error:
        raise ValueError('Invalid saved record timestamp') from error
    ReactionDefinition.parse(value['definition'], submitted=True)
    return value


def parse_chemical_embedding(value):
    """Parse portable supplied provenance; parsing alone never verifies its owner."""
    fields(value, {'name', 'graph', 'source'})
    string(value['name'], 'chemical label', 200)
    MolecularGraph.parse(value['graph'])
    source = value['source']
    if source is not None:
        fields(source, {'id', 'revision', 'moleculeId', 'original'})
        ScientificPin.parse(dict(id=source['id'], revision=source['revision']))
        block_id(source['moleculeId'])
        MolecularGraph.parse(source['original'])
    return value


def validate_local_chemical_sources(connection, document):
    """Reject contradicted local pins at publication; absent owners stay unverified."""
    if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notebook_scientific_records'").fetchone():
        return
    for node in document.nodes():
        if node['type'] != 'chemical':
            continue
        source = node['attrs']['chemical']['source']
        if source is None:
            continue
        revision = connection.execute('''SELECT definition FROM notebook_scientific_records
            WHERE kind = 'reactions' AND record_id = ? AND revision = ?''', (source['id'], source['revision'])).fetchone()
        if revision is None:
            if connection.execute("SELECT 1 FROM notebook_scientific_records WHERE kind = 'reactions' AND record_id = ? LIMIT 1", (source['id'],)).fetchone():
                raise ValueError('Chemical source revision does not exist in the local reaction record')
            continue  # A portable reference is retained, not asserted to be locally verified.
        definition = ReactionDefinition.parse(json.loads(revision['definition']), submitted=True)
        molecule = next((item for item in definition.molecules if item.id == source['moleculeId']), None)
        if molecule is None or molecule.graph.wire() != source['original']:
            raise ValueError('Chemical source molecule or original graph contradicts the local reaction revision')


def parse_scientific_attributes(kind, value):
    """Document parser owns attribute keys and block IDs; this owns scientific data."""
    if kind == 'chemical':
        parse_chemical_embedding(value['chemical'])
    elif kind == 'reactionScheme':
        ReactionDefinition.parse(value['reaction'])
        if value['record'] is not None:
            parse_reaction_record(value['record'])
    else:
        raise ValueError('Unknown scientific block kind')


class ScientificDesignStore:
    """Immutable revisions with compare-and-swap at the existing local SQLite seam."""
    def __init__(self, entries):
        self.path = entries.path
        with closing(self._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS notebook_scientific_records (
                kind TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL,
                saved_at TEXT NOT NULL, definition TEXT NOT NULL,
                PRIMARY KEY(kind, record_id, revision))''')

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _wire(row):
        return dict(id=row['record_id'], revision=row['revision'], savedAt=row['saved_at'], definition=json.loads(row['definition']))

    def list(self, kind):
        with closing(self._connect()) as connection:
            rows = connection.execute('''SELECT * FROM notebook_scientific_records WHERE kind = ? AND
                (record_id, revision) IN (SELECT record_id, MAX(revision) FROM notebook_scientific_records WHERE kind = ? GROUP BY record_id)
                ORDER BY saved_at DESC, record_id LIMIT 200''', (kind, kind))
            return [self._wire(row) for row in rows]

    def _read(self, connection, kind, identity, revision=None):
        row = connection.execute('''SELECT * FROM notebook_scientific_records
            WHERE kind = ? AND record_id = ? AND (? IS NULL OR revision = ?)
            ORDER BY revision DESC LIMIT 1''', (kind, identity, revision, revision)).fetchone()
        if row is None:
            raise MissingScientificRecord('Local scientific record or revision not found')
        return self._wire(row)

    def read(self, kind, identity, revision=None):
        with closing(self._connect()) as connection:
            return self._read(connection, kind, identity, revision)

    def save(self, definition, identity=None, expected_revision=None):
        kind = 'plates' if isinstance(definition, PlateDesign) else 'reactions'
        wire = definition.wire()
        with closing(self._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            revision = 1
            if identity is None:
                identity = uuid4().hex
            else:
                current = self._read(connection, kind, identity)
                if current['revision'] != expected_revision:
                    raise RevisionConflict(current['revision'])
                revision = current['revision'] + 1
            # A local derivation must refer to an existing immutable design revision.
            if kind == 'plates' and definition.origin is not None:
                self._read(connection, kind, definition.origin.id, definition.origin.revision)
            saved_at = datetime.now(timezone.utc).isoformat(timespec='microseconds')
            connection.execute('INSERT INTO notebook_scientific_records VALUES (?, ?, ?, ?, ?)',
                (kind, identity, revision, saved_at, json.dumps(wire, ensure_ascii=False, allow_nan=False)))
            return self._read(connection, kind, identity, revision)
