"""Check a Control Lab submission against the actual saved Notebook parameters."""
from catalog import StructuredTableDraft, _fields
from procedure_parameters import ParameterField, ParameterLiteral


def require_saved_control_parameters(document, binding):
    inputs = _fields(binding['inputs'], ('submissionId', 'horizon', 'samples'))
    if inputs['submissionId'] != binding['id']:
        raise ValueError('The Control Lab submission does not match the saved binding')
    for name in ('horizon', 'samples'):
        pin = _fields(inputs[name], ('procedureId', 'parameterId', 'version', 'value'))
        procedure = next((item for item in document.procedures or () if item.id == pin['procedureId']), None)
        parameter = next((item for item in procedure.parameters or () if item.column.identity == pin['parameterId']), None) if procedure else None
        if (parameter is None or parameter.version != pin['version'] or
                (parameter.step_id is not None and not any(step.id == parameter.step_id for step in procedure.steps))):
            raise ValueError('Review and bind the latest saved Notebook parameter')
        source = parameter.source
        if isinstance(source, ParameterField):
            block = document.block(source.block_id)
            if not block or block['type'] not in ('inputTable', 'registrationTable'):
                raise ValueError('The pinned Notebook table is missing')
            table = StructuredTableDraft.parse(block['attrs']['table'])
            row = next((item for item in table.rows if item.identity == source.row_id), None)
            column = next((item for item in table.columns if item.identity == source.column_id), None)
            if (not row or column != source.column or column.kind != parameter.column.kind
                    or (table.identity, table.schema_id, table.schema_revision) != (source.table_id, source.schema_id, source.schema_revision)
                    or dict(row.cells).get(source.column_id, '') != source.raw):
                raise ValueError('Review and repin the changed Notebook table field')
            column.validate()
            column.parse_cell(source.raw)
        elif not isinstance(source, ParameterLiteral):
            raise ValueError('Select a recorded or table-pinned Notebook parameter')
        parameter.column.validate()
        value = parameter.column.parse_cell(source.raw)
        expected_type, expected_unit = ('quantity', 's') if name == 'horizon' else ('decimal', '')
        if (value.kind, value.unit, value.value) != (expected_type, expected_unit, pin['value']):
            raise ValueError('The Control Lab input differs from the saved Notebook parameter')
