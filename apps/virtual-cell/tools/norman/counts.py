"""Bounded CSC count reads for the pinned H5AD and synthetic sparse fixtures.

Only indptr (one integer per gene plus one) is held in memory. Data/indices
may be HDF5 datasets or NumPy arrays; every read is capped by max_nnz, even
for a single highly expressed gene. No backed AnnData row slicing is used.
"""
from dataclasses import dataclass
import numpy as np

from contract import Invalid


@dataclass(frozen=True)
class CountChunk:
    column: int
    offset: int
    rows: np.ndarray
    values: np.ndarray


@dataclass(frozen=True)
class CSCCounts:
    shape: tuple
    data: object
    indices: object
    indptr: np.ndarray
    max_nnz: int = 65536

    def __post_init__(self):
        if (len(self.shape) != 2 or any(not isinstance(n, int) or n < 1 for n in self.shape)
                or not isinstance(self.max_nnz, int) or self.max_nnz < 1):
            raise Invalid("source_csc_shape")
        if getattr(self.data, "ndim", None) != 1 or getattr(self.indices, "ndim", None) != 1:
            raise Invalid("source_csc_arrays")
        pointers = self.indptr
        if (pointers.shape != (self.shape[1] + 1,) or not np.issubdtype(pointers.dtype, np.integer)
                or pointers[0] != 0 or (pointers[1:] < pointers[:-1]).any()
                or pointers[-1] != len(self.data) or len(self.indices) != len(self.data)):
            raise Invalid("source_csc_indptr")

    @classmethod
    def from_sparse(cls, matrix, max_nnz=65536):
        """Fixture boundary only: the caller already owns an in-memory matrix."""
        csc = matrix.tocsc(copy=True)
        return cls(csc.shape, csc.data, csc.indices, csc.indptr, max_nnz)

    @classmethod
    def from_hdf5(cls, group):
        if group.attrs.get("encoding-type") not in ("csc_matrix", b"csc_matrix"):
            raise Invalid("source_X_must_be_csc", "The fixed source uses CSC; no automatic full-matrix conversion")
        return cls(tuple(int(n) for n in group.attrs["shape"]), group["data"], group["indices"],
                   np.asarray(group["indptr"][:]))

    def chunks(self, columns=None):
        for column in range(self.shape[1]) if columns is None else sorted(columns):
            begin, end = int(self.indptr[column]), int(self.indptr[column + 1])
            for start in range(begin, end, self.max_nnz):
                stop = min(start + self.max_nnz, end)
                yield CountChunk(column, start, np.asarray(self.indices[start:stop]),
                                 np.asarray(self.data[start:stop], dtype=np.float64))


def library_sums(counts):
    """Entry-point validation; sum all source genes in stable gene/row order.

    Strictly increasing indices reject ambiguous duplicate/unsorted CSC entries
    instead of silently merging/reordering the external source. Later passes use
    the same read-only source and need not repeat count or index validation.
    """
    libraries = np.zeros(counts.shape[0], dtype=np.float64)
    previous_column, previous_row = -1, -1
    for chunk in counts.chunks():
        rows, values = chunk.rows, chunk.values
        detail = {"gene_index": chunk.column, "nnz_offset": chunk.offset}
        if (not np.issubdtype(rows.dtype, np.integer) or (rows < 0).any() or (rows >= counts.shape[0]).any()
                or (rows[1:] <= rows[:-1]).any()
                or (chunk.column == previous_column and rows[0] <= previous_row)):
            raise Invalid("source_csc_indices_invalid", detail)
        if not np.isfinite(values).all() or (values < 0).any() or (values != np.floor(values)).any():
            raise Invalid("source_not_nonnegative_integer_counts", detail)
        libraries[rows] += values
        previous_column, previous_row = chunk.column, rows[-1]
    if not np.isfinite(libraries).all():
        raise Invalid("source_library_not_finite")
    return libraries


def training_moments(counts, libraries, training):
    """Per-gene moments of log1p CP10k; zeros count in the cell denominator."""
    sums, squares = np.zeros(counts.shape[1]), np.zeros(counts.shape[1])
    for chunk in counts.chunks():
        selected = training[chunk.rows]
        rows = chunk.rows[selected]
        values = np.log1p(chunk.values[selected] * (10000.0 / libraries[rows]))
        sums[chunk.column] += values.sum(dtype=np.float64)
        squares[chunk.column] += np.square(values).sum(dtype=np.float64)
    return sums, squares, int(training.sum())


def group_sums(counts, libraries, columns, groups, group_count):
    """Read only selected genes; groups=-1 excludes cells, all others keep zeros."""
    sums = np.zeros((group_count, len(columns)), dtype=np.float64)
    axis = {column: index for index, column in enumerate(columns)}
    for chunk in counts.chunks(columns):
        selected = groups[chunk.rows] >= 0
        rows = chunk.rows[selected]
        values = np.log1p(chunk.values[selected] * (10000.0 / libraries[rows]))
        sums[:, axis[chunk.column]] += np.bincount(groups[rows], weights=values, minlength=group_count)
    return sums
