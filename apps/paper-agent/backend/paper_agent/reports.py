"""Report and exact-quotation rules ported from Point Paper Agent (Apache-2.0)."""
from dataclasses import dataclass
import json
import re

from .model import REPORT_SCHEMA, Invalid, ResearchInput, canonical, mapping, sequence, text


@dataclass(frozen=True)
class EvidenceReference:
    paper_id: str
    quote: str
    passage_id: str | None = None

    @classmethod
    def parse_many(cls, value, cited_ids, papers, passages=()):
        references = []
        for item in sequence(value, 8, "evidence list (maximum 8 references)"):
            item = mapping(item, "evidence reference")
            quote = item.get("quote")
            text(quote, 4000, "evidence quotation")
            ref = cls(text(item.get("paperId"), 64, "evidence source"), quote, item.get("passageId"))
            if ref.paper_id not in cited_ids:
                raise Invalid("Evidence is outside the cited sources")
            ref.locate(papers, passages)
            references.append(ref)
        return tuple(references)

    def locate(self, papers, passages=()):
        paper = next((paper for paper in papers if paper.id == self.paper_id), None)
        if paper is None:
            raise Invalid("Evidence source is outside the frozen input")
        if passages or self.passage_id:
            passage = next((p for p in passages if p.id == self.passage_id and p.paper_id == self.paper_id), None)
            if passage is None or self.quote not in passage.content:
                raise Invalid('Evidence is outside the frozen PDF passages')
            offset = passage.content.index(self.quote)
            return dict(paperId=paper.id, start=offset, end=offset + len(self.quote), heading=f'Page {passage.page}',
                        before=passage.content[max(0, offset - 500):offset], quote=self.quote,
                        after=passage.content[offset + len(self.quote):offset + len(self.quote) + 500],
                        pdf=dict(documentId=passage.document_id, fileDigest=passage.file_digest,
                                 pages=[passage.page], sourceStart=passage.start + offset))
        start = paper.content.find(self.quote)
        if start < 0:
            raise Invalid("Evidence quotation is absent from the frozen source")
        headings = re.findall(r"^#{1,6}\s+(.+)$", paper.content[:start], re.M)
        end = start + len(self.quote)
        return dict(paperId=paper.id, start=start, end=end, heading=headings[-1] if headings else "",
                    before=paper.content[max(0, start - 500):start], quote=self.quote, after=paper.content[end:end + 500])

    def source_url(self, papers, passages):
        passage = next((p for p in passages if p.id == self.passage_id), None)
        paper = next(p for p in papers if p.id == self.paper_id)
        return (paper.pdf_url or paper.url).split('#')[0] + f'#page={passage.page}' if passage else paper.url

    def to_dict(self):
        return dict(paperId=self.paper_id, quote=self.quote, **(dict(passageId=self.passage_id) if self.passage_id else {}))


def paper_refs(value, allowed):
    values = sequence(value, 8, "paper IDs")
    if not values or any(not isinstance(item, str) or item not in allowed for item in values) or len(set(values)) != len(values):
        raise Invalid("Unknown or missing paper reference")
    return tuple(values)


@dataclass(frozen=True)
class ReportSection:
    heading: str
    content: str
    paper_ids: tuple[str, ...]
    evidence: tuple[EvidenceReference, ...]

    def to_dict(self):
        return dict(heading=self.heading, content=self.content, paperIds=list(self.paper_ids),
                    evidence=[ref.to_dict() for ref in self.evidence])


@dataclass(frozen=True)
class CodeFile:
    path: str
    language: str
    content: str

    @classmethod
    def parse(cls, value):
        value = mapping(value, "code file")
        path = text(value.get("path"), 300, "code path")
        if re.search(r"^[\\/]|^[a-z]:|[\x00-\x1f]", path, re.I) or ".." in re.split(r"[\\/]", path):
            raise Invalid("Code paths must be workspace-relative")
        content = value.get("content")
        text(content, 40000, "code")
        return cls(path, text(value.get("language"), 40, "language"), content)

    def to_dict(self):
        return dict(path=self.path, language=self.language, content=self.content)


@dataclass(frozen=True)
class Experiment:
    title: str
    paper_ids: tuple[str, ...]
    evidence: tuple[EvidenceReference, ...]
    status: str
    files: tuple[CodeFile, ...]
    commands: tuple[str, ...]
    expected: str
    observed: str
    limitations: str

    @classmethod
    def parse(cls, value, allowed, papers, passages=()):
        value = mapping(value, "experiment")
        status = value.get("status")
        if status not in ("passed", "failed", "blocked", "not-run"):
            raise Invalid("Invalid reported experiment status")
        refs = paper_refs(value.get("paperIds"), allowed)
        evidence = EvidenceReference.parse_many(value.get("evidence", []), refs, papers, passages)
        files = tuple(CodeFile.parse(file) for file in sequence(value.get("files"), 12, "code files"))
        commands = tuple(text(command, 2000, "command") for command in sequence(value.get("commands"), 12, "commands"))
        observed = text(value.get("observed"), 12000, "observed result")
        if status in ("passed", "failed") and (not files or not commands):
            raise Invalid("Reported execution needs code, commands and observations")
        return cls(text(value.get("title"), 200, "experiment title"), refs, evidence, status,
                   files, commands, text(value.get("expected"), 4000, "expected result"), observed,
                   text(value.get("limitations"), 4000, "experiment limitations"))

    def to_dict(self):
        return dict(title=self.title, paperIds=list(self.paper_ids), evidence=[ref.to_dict() for ref in self.evidence],
                    status=self.status, files=[file.to_dict() for file in self.files], commands=list(self.commands),
                    expected=self.expected, observed=self.observed, limitations=self.limitations, provenance="agent-reported")


@dataclass(frozen=True)
class MatrixColumn:
    id: str
    label: str


@dataclass(frozen=True)
class MatrixCell:
    paper_id: str
    column_id: str
    value: str
    status: str
    evidence: tuple[EvidenceReference, ...]


@dataclass(frozen=True)
class EvidenceMatrix:
    columns: tuple[MatrixColumn, ...]
    cells: tuple[MatrixCell, ...]

    @classmethod
    def parse(cls, value, papers, passages=()):
        value = mapping(value, 'evidence matrix')
        columns = tuple(MatrixColumn(text(c.get('id'), 40, 'column ID'), text(c.get('label'), 100, 'column label'))
                        for item in sequence(value.get('columns'), 8, 'matrix columns')
                        for c in [mapping(item, 'matrix column')])
        ids = {c.id for c in columns}
        if not columns or len(ids) != len(columns):
            raise Invalid('Matrix columns must have unique IDs')
        allowed = {p.id for p in papers}
        cells, seen = [], set()
        for item in sequence(value.get('cells'), 40, 'matrix cells'):
            item = mapping(item, 'matrix cell')
            paper_id, column_id, status = item.get('paperId'), item.get('columnId'), item.get('status')
            if paper_id not in allowed or column_id not in ids:
                raise Invalid('Matrix cell is outside the frozen sources or columns')
            key = (paper_id, column_id)
            if key in seen:
                raise Invalid('Duplicate matrix cell')
            seen.add(key)
            if status not in ('supported', 'missing', 'conflict'):
                raise Invalid('Invalid matrix evidence status')
            refs = EvidenceReference.parse_many(item.get('evidence', []), (paper_id,), papers, passages)
            content = item.get('value', '')
            if status == 'missing':
                if content != '' or refs:
                    raise Invalid('Missing matrix cells cannot assert a value or evidence')
            else:
                text(content, 4000, 'matrix value')
                if not refs or (status == 'conflict' and len({r.quote for r in refs}) < 2):
                    raise Invalid('Matrix values need exact evidence; conflicts need two passages')
            cells.append(MatrixCell(paper_id, column_id, content, status, refs))
        return cls(columns, tuple(cells))

    def to_dict(self):
        return dict(columns=[dict(id=c.id, label=c.label) for c in self.columns], cells=[
            dict(paperId=c.paper_id, columnId=c.column_id, value=c.value, status=c.status,
                 evidence=[e.to_dict() for e in c.evidence]) for c in self.cells])


@dataclass(frozen=True)
class ResearchReport:
    intent_id: str
    title: str
    sections: tuple[ReportSection, ...]
    experiments: tuple[Experiment, ...]
    limitations: str
    matrix: "EvidenceMatrix | None" = None

    @classmethod
    def parse(cls, value, intent):
        value = mapping(value, "report")
        if value.get("schema") not in (REPORT_SCHEMA, "point.paper-agent-report.v1") or value.get("intentId") != intent.id:
            raise Invalid("Report does not match the frozen research input")
        allowed = {paper.id for paper in intent.papers}
        sections = []
        for section in sequence(value.get("sections"), 12, "sections"):
            section = mapping(section, "report section")
            refs = paper_refs(section.get("paperIds"), allowed)
            evidence = EvidenceReference.parse_many(section.get("evidence", []), refs, intent.papers, intent.passages)
            if intent.passages and not evidence:
                raise Invalid('PDF answer sections require source evidence')
            sections.append(ReportSection(text(section.get("heading"), 200, "heading"),
                                          text(section.get("content"), 24000, "content"), refs, evidence))
        if not sections:
            raise Invalid("A report needs at least one cited section")
        experiments = tuple(Experiment.parse(item, allowed, intent.papers, intent.passages) for item in sequence(value.get("experiments"), 6, "experiments"))
        if intent.verify_code and not experiments:
            raise Invalid("A code-verification request needs an experiment or an explicit blocked/not-run entry")
        title = text(value.get("title"), 200, "title")
        if len(title.encode("utf-8")) > 200:
            raise Invalid("Report title exceeds 200 UTF-8 bytes")
        matrix = EvidenceMatrix.parse(value["matrix"], intent.papers, intent.passages) if value.get("matrix") is not None else None
        result = cls(intent.id, title, tuple(sections), experiments, text(value.get("limitations"), 8000, "limitations"), matrix)
        if len(canonical(result.to_dict())) > 450000:
            raise Invalid("Report exceeds 450,000 bytes")
        return result

    @classmethod
    def from_text(cls, source, intent):
        if not isinstance(source, str) or len(source) > 500000:
            raise Invalid("Agent output exceeds the report limit")
        source = source.strip()
        match = re.fullmatch(r"```(?:json)?\s*\n([\s\S]*?)\n```", source)
        try:
            value = json.loads(match[1] if match else source)
        except (ValueError, RecursionError) as error:
            raise Invalid("No valid JSON report was returned; keep the output and correct its format") from error
        return cls.parse(value, intent)

    def to_dict(self):
        return dict(**({"matrix": self.matrix.to_dict()} if self.matrix else {}), schema=REPORT_SCHEMA, intentId=self.intent_id, title=self.title,
                    sections=[section.to_dict() for section in self.sections],
                    experiments=[experiment.to_dict() for experiment in self.experiments],
                    limitations=self.limitations, acceptance="unverified")

    def markdown(self, intent: ResearchInput):
        # Reports are plain text; escape embedded HTML while retaining Markdown export.
        def prose(value):
            return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        def sources(ids):
            papers = {paper.id: paper for paper in intent.papers}
            return " · ".join(f'[{prose(papers[item].title).replace("[", "(").replace("]", ")")}]({papers[item].url.replace(")", "%29")})' for item in ids)

        def quotations(refs):
            return "\n\n".join("> " + prose(ref.quote).replace("\n", "\n> ") + "\n>\n> " + (f"[Page {next(p.page for p in intent.passages if p.id == ref.passage_id)}]({ref.source_url(intent.papers, intent.passages)})" if ref.passage_id else sources([ref.paper_id])) for ref in refs)

        lines = [f"# {prose(self.title)}", "", "Acceptance: unverified · experiment results: agent-reported", "",
                 f"Frozen research input: `{self.intent_id}`", ""]
        for section in self.sections:
            lines.extend([f"## {prose(section.heading)}", "", prose(re.sub(r"\[([^\]]*)\]\(evidence:([1-9]\d*)\)",
                lambda m: f"[{m[1]}]({section.evidence[int(m[2])-1].source_url(intent.papers, intent.passages)})"
                if int(m[2]) <= len(section.evidence) else m[1] + " [unresolved citation]", section.content)), "", sources(section.paper_ids), "", quotations(section.evidence), ""])
        if self.matrix:
            lines.extend(["## Evidence matrix", ""])
            for paper in intent.papers:
                lines.extend(["### " + prose(paper.title), ""])
                for column in self.matrix.columns:
                    cell = next((c for c in self.matrix.cells if c.paper_id == paper.id and c.column_id == column.id), None)
                    lines.extend(["#### " + prose(column.label), "", (prose(cell.value) if cell and cell.value else "Missing") + " · " + (cell.status if cell else "missing"), "", quotations(cell.evidence) if cell else "", ""])
        for experiment in self.experiments:
            lines.extend([f"## {prose(experiment.title)}", "", f"Agent-reported: {experiment.status}", "", sources(experiment.paper_ids), "",
                          f"Expected: {prose(experiment.expected)}", "", f"Observed: {prose(experiment.observed)}", "",
                          f"Limitations: {prose(experiment.limitations)}", "", quotations(experiment.evidence), ""])
            if experiment.commands:
                content = "\n".join(experiment.commands)
                fence = "`" * max(3, max((len(run) + 1 for run in re.findall(r"`+", content)), default=3))
                lines.extend(["Commands:", "", fence + "sh", content, fence, ""])
            for file in experiment.files:
                fence = "`" * max(3, max((len(run) + 1 for run in re.findall(r"`+", file.content)), default=3))
                language = re.sub(r"[^a-z0-9+-]", "", file.language, flags=re.I)
                lines.extend([f"### {prose(file.path)}", "", fence + language, file.content, fence, ""])
        lines.extend(["## Limitations", "", prose(self.limitations), "", "## Sources", ""])
        for paper in intent.papers:
            lines.append(f"- {sources([paper.id])} — {paper.content_kind}; {paper.content_digest}; {paper.fetched_at}")
        for doc_id in dict.fromkeys(p.document_id for p in intent.passages):
            passage = next(p for p in intent.passages if p.document_id == doc_id)
            lines.append(f"- PDF {doc_id}; SHA-256 {passage.file_digest}")
        if intent.retrieval:
            lines.extend(['', '## Retrieval scope', '', f'Method: {intent.retrieval.method}',
                          f'Returned passages: {len(intent.passages)} / {intent.retrieval.total_matches} lexical matches.',
                          'Excerpts only; keyword relevance does not establish scientific support.'])
            if intent.retrieval.unmatched_paper_ids:
                lines.append('No returned passages from: ' + sources(intent.retrieval.unmatched_paper_ids))
        return "\n".join(lines)
