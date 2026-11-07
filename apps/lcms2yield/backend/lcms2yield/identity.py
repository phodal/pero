"""Chemical-identity overlap. This module does not import RDKit; the caller supplies it."""


def model_canonical(chem, smiles):
    """Successful path of ``from_smiles(smiles, with_hydrogen=True)``.

    The released dataset builds each graph that way. An unparsable SMILES stays
    ``None``. The model would substitute an empty molecule; that is not an identity.
    """
    if not isinstance(smiles, str) or not smiles:
        return None
    try:
        molecule = chem.MolFromSmiles(smiles)
        if molecule is None:
            return None
        return chem.MolToSmiles(chem.AddHs(molecule))
    except Exception:
        return None


def overlap(groups):
    """groups maps a population name to canonical SMILES. None entries are parse failures and are excluded from the sets."""
    sets = {}
    failures = {}
    for name, values in groups.items():
        failed = sum(value is None for value in values)
        sets[name] = {value for value in values if value is not None}
        failures[name] = failed
    names = tuple(sets)
    pairs = []
    for index, left in enumerate(names):
        for right in names[index + 1:]:
            pairs.append({'left': left, 'right': right, 'shared': len(sets[left] & sets[right])})
    return {'populations': {name: {'parsed': len(sets[name]), 'failed': failures[name]} for name in names}, 'shared': pairs}
