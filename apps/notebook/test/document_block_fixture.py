"""Test-only document block. It is not a product type and it is not added to BLOCKS."""

from block_registry import BlockDefinition, document_block, register_definition
from document import BLOCKS, string


def validate_axis_span(value):
    def version_one(attrs):
        if not attrs['low'] < attrs['high']:
            raise ValueError('Invalid axis span order')
        string(attrs['unit'], 'axis span unit', 32)
    document_block(value, {'low': 0, 'high': 1, 'unit': ''}, version_one)


def register_axis_span():
    if 'axisSpan' in BLOCKS:
        raise AssertionError('axisSpan must stay out of BLOCKS')
    register_definition(BlockDefinition('axisSpan', 1, validate=validate_axis_span))
