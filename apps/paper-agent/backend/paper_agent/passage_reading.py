"""An observed passage carries numbered original lines for precise selections."""
from dataclasses import dataclass
from .model import PdfPassage
from .source_text import SourceText


@dataclass(frozen=True)
class PassageReading:
    passage: PdfPassage

    def to_dict(self):
        lines = SourceText(self.passage.content).lines
        return dict(**self.passage.to_dict(), lineCount=len(lines),
                    citationLines=[dict(line=index, text=line) for index, line in enumerate(lines, 1)])
