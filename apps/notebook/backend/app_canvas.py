"""Persist navigation references only. Host owns installation and panel admission."""
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class AppCanvasBinding:
    id: str
    app: str
    panel: str

    @classmethod
    def parse(cls, value):
        if value is None:
            return None
        if not isinstance(value, dict) or set(value) != {'id', 'app', 'panel'}:
            raise ValueError('Invalid App binding fields')
        if not isinstance(value['id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value['id']):
            raise ValueError('Invalid App binding identity')
        for key in ('app', 'panel'):
            if not isinstance(value[key], str) or len(value[key]) > 128 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', value[key]):
                raise ValueError('Invalid App or panel identifier')
        return cls(**value)
