"""Safe archive representations and literal TeX, with no external files or tools."""
import gzip
import io
from pathlib import Path
import sys
import tarfile
import unittest
import struct
import zlib
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.model import Invalid, digest
from paper_agent.source_archive import SourceArchive, tex_structures

TEX = r'''\documentclass{article}
% \begin{table}\caption{Invented comment}\end{table}
\begin{document}
\begin{verbatim}\begin{figure}\caption{Invented verbatim}\end{figure}\end{verbatim}
\begin{figure*}
\includegraphics[width=4cm]{figures/plot.png}
\caption*{Synthetic source figure.}
\end{figure*}
\textbf{Nearby heading is not a caption}
\begin{longtable}{ll}
A & B \\
\end{longtable}
\begin{table}\caption{Literal outcomes.}\begin{tabularx}{x}{ll}A & B\end{tabularx}\end{table}
\input{untrusted.tex}
\begin{thebibliography}{9}
\bibitem{first} A literal reference.
\bibitem{second} Another reference.
\end{thebibliography}
\end{document}
'''


def archive_bytes(entries, zipped=True):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for name, value in entries:
            entry = name if isinstance(name, tarfile.TarInfo) else tarfile.TarInfo(name)
            entry.size = len(value)
            archive.addfile(entry, io.BytesIO(value))
    return gzip.compress(stream.getvalue()) if zipped else stream.getvalue()


class SourceArchiveTest(unittest.TestCase):
    def test_real_literal_structures_lines_and_representations(self):
        raw = TEX.encode()
        for payload, format in ((raw, 'plain-tex'), (gzip.compress(raw), 'gzip-tex'),
                                (archive_bytes([('main.tex', raw)]), 'tar.gz'),
                                (archive_bytes([('main.tex', raw)], False), 'tar')):
            with self.subTest(format=format):
                result, blobs, _ = SourceArchive.inspect(payload)
                self.assertEqual((result.status, result.format), ('source_available', format))
                self.assertEqual(result.sha256, digest(payload))
                member = result.members[0]
                self.assertEqual(blobs[member.sha256], raw)
                self.assertEqual(member.lineCount, len(TEX.splitlines()))
                kinds = [s.kind for s in member.structures]
                self.assertEqual(kinds.count('caption'), 2)
                self.assertEqual(kinds.count('bibitem'), 2)
                self.assertTrue({'longtable', 'tabularx', 'table', 'figure*', 'includegraphics', 'input'} <= set(kinds))
                table = next(s for s in member.structures if s.kind == 'longtable')
                self.assertIsNone(table.caption)
                self.assertIn('Nearby heading', table.context)
                self.assertEqual(TEX[table.start:table.end], '\n'.join(TEX.splitlines()[table.startLine - 1:table.endLine]))
        pdf, _, _ = SourceArchive.inspect(b'%PDF-1.7\nnot parsed as TeX')
        self.assertEqual((pdf.status, pdf.format), ('pdf_only', 'pdf'))
        compressed_pdf, _, _ = SourceArchive.inspect(gzip.compress(b'%PDF-1.7'))
        self.assertEqual(compressed_pdf.status, 'pdf_only')
        with self.assertRaisesRegex(Invalid, 'HTML'):
            SourceArchive.inspect(b'<!DOCTYPE html><html>challenge</html>')
        nontex, _, _ = SourceArchive.inspect(archive_bytes([('README.txt', b'No TeX was supplied')]))
        self.assertEqual(nontex.status, 'no_tex')
        unknown, _, _ = SourceArchive.inspect(archive_bytes([('main.tex', b'\\documentclass{a}\xff')]))
        self.assertEqual((unknown.status, unknown.members[0].kind), ('no_tex', 'unknown_encoding'))

    def test_archive_path_type_count_size_and_nested_limits(self):
        for name in ('/absolute.tex', '../outside.tex', 'a/../x.tex', 'a\\x.tex', 'C:evil.tex', '/'.join(['d'] * 17) + '/x.tex'):
            with self.subTest(name=name), self.assertRaises(Invalid):
                SourceArchive.inspect(archive_bytes([(name, b'x')]))
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.FIFOTYPE, tarfile.GNUTYPE_SPARSE):
            entry = tarfile.TarInfo('unsafe')
            entry.type, entry.linkname = kind, 'outside'
            with self.subTest(kind=kind), self.assertRaises(Invalid):
                SourceArchive.inspect(archive_bytes([(entry, b'')]))
        for entries in ([('a.tex', b'a'), ('./a.tex', b'b')], [('nested.gz', gzip.compress(b'x'))],
                        [('payload', b'PK\x03\x04')], [('big.tex', b'x' * (2 * 1024 * 1024 + 1))],
                        [(str(i), b'') for i in range(1025)]):
            with self.subTest(first=entries[0][0]), self.assertRaises(Invalid):
                SourceArchive.inspect(archive_bytes(entries))
        with patch('paper_agent.source_archive.MAX_EXPANDED', 1024):
            with self.assertRaisesRegex(Invalid, '64 MiB'):
                SourceArchive.inspect(gzip.compress(b'x' * 1025))
        with self.assertRaisesRegex(Invalid, 'ZIP'):
            SourceArchive.inspect(b'PK\x03\x04unsupported')
        with self.assertRaisesRegex(Invalid, 'Damaged'):
            SourceArchive.inspect(b'\x1f\x8bgarbage')

    def test_disguised_vector_and_oversize_images_never_decode_or_run_ghostscript(self):
        from PIL import Image
        stream = io.BytesIO()
        Image.new('RGB', (1, 1), 'red').save(stream, format='PNG')
        png = bytearray(stream.getvalue())
        png[16:24] = struct.pack('>II', 5000, 5000)
        png[29:33] = struct.pack('>I', zlib.crc32(png[12:29]) & 0xffffffff)
        payloads = (b'%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 1 1\nshowpage\n',
                    b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', bytes(png))
        for payload in payloads:
            with self.subTest(magic=payload[:8]), patch('PIL.EpsImagePlugin.Ghostscript') as ghostscript, patch('PIL.ImageFile.ImageFile.load') as decode:
                archive, _, previews = SourceArchive.inspect(archive_bytes([('disguised.png', payload)]))
                self.assertFalse(archive.members[0].preview)
                self.assertTrue(archive.members[0].warning)
                self.assertEqual(previews, {})
                ghostscript.assert_not_called()
                decode.assert_not_called()

    def test_original_and_preview_dimensions_are_distinct_and_legacy_unknown(self):
        from PIL import Image
        output = io.BytesIO()
        with Image.new('RGB', (1775, 810), 'red') as original:
            original.save(output, format='PNG')
        archive, _, previews = SourceArchive.inspect(archive_bytes([('figure.png', output.getvalue())]))
        member = archive.members[0]
        self.assertEqual((member.originalWidth, member.originalHeight), (1775, 810))
        self.assertEqual((member.previewWidth, member.previewHeight), (1600, 730))
        self.assertEqual((member.width, member.height), (1600, 730))
        self.assertEqual((member.sha256, member.size), (digest(output.getvalue()), len(output.getvalue())))
        with Image.open(io.BytesIO(previews[member.id])) as preview:
            self.assertEqual(preview.size, (member.previewWidth, member.previewHeight))
        record = archive.to_dict()
        for field in ('originalWidth', 'originalHeight', 'previewWidth', 'previewHeight'):
            record['members'][0].pop(field)
        legacy = SourceArchive.from_record(record).members[0]
        self.assertEqual((legacy.originalWidth, legacy.originalHeight), (None, None))
        self.assertEqual((legacy.previewWidth, legacy.previewHeight), (1600, 730))

    def test_image_preview_is_bounded_reencoded_and_unsupported_is_listed(self):
        from PIL import Image
        output = io.BytesIO()
        with Image.new('RGB', (3, 2), 'red') as image:
            image.save(output, format='PNG')
        result, _, previews = SourceArchive.inspect(archive_bytes([('main.tex', TEX.encode()), ('figure.png', output.getvalue()),
            ('unsafe.svg', b'<svg onload="execute()"/>'), ('unknown.png', b'not png')]))
        image = next(m for m in result.members if m.path == 'figure.png')
        self.assertTrue(image.preview)
        self.assertTrue(previews[image.id].startswith(b'\x89PNG'))
        for member in result.members:
            if member.path in ('unsafe.svg', 'unknown.png'):
                self.assertFalse(member.preview)
                self.assertTrue(member.warning)
        cr = tex_structures('one\r\\caption{Literal caption.}\r')
        self.assertEqual(cr[0].startLine, 2)
        self.assertIsNone(tex_structures('\\caption{' + 'x' * 4001 + '}')[0].caption)
        with self.assertRaisesRegex(Invalid, 'nesting'):
            tex_structures('\\caption{' + '{' * 65 + 'x' + '}' * 66)


if __name__ == '__main__':
    unittest.main()
