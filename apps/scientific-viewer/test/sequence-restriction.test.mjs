import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseGenBank } from '../ui-src/sequence-record.ts';
import { restrictionSites } from '../ui-src/sequence-restriction.ts';

test('pBR322 cut boundaries agree with Benchling and the NEB pBR322 map', async () => {
  const text = await readFile(new URL('../assets/sequences/pBR322.gb', import.meta.url), 'utf8');
  const sites = restrictionSites(parseGenBank(text));
  // J01749.1 and NEB pBR322 use the same origin. Numbers count the bases before each top-strand cut.
  const expected = {
    AatII: [4288], AccI: [652, 2245], AseI: [3538], BamHI: [375], BanII: [475, 489], BmtI: [233],
    BsaBI: [1672], BsaI: [3427], BsmBI: [2116], BspDI: [24], BtgI: [528, 1447], ClaI: [24],
    EagI: [939], EcoNI: [626], EcoRI: [4359], EcoRV: [187], FspAI: [262, 1456], HindIII: [29],
    NheI: [229], NruI: [974], PciI: [2473], PstI: [3611], PvuI: [3736], PvuII: [2066], SalI: [651],
    ScaI: [3846], SgrAI: [410], SphI: [566], SspI: [4170], XmnI: [2033, 3965],
  };
  const byEnzyme = Object.groupBy(sites, site => site.name);
  assert.deepEqual({ ...Object.fromEntries(Object.entries(byEnzyme).map(([name, hits]) => [name, hits.map(hit => hit.top)])) }, expected);
  const [ecoRI] = byEnzyme.EcoRI;
  assert.equal(ecoRI.bottom, 2);
  assert.deepEqual(ecoRI.spans, [{ start: 4358, end: 4361 }, { start: 0, end: 3 }]);
});

test('cut detection respects linear ends, direction and ambiguous template bases', () => {
  const forward = restrictionSites({ bases: 'AAAGGTCTCAAAAAAAA', circular: false }).find(site => site.name === 'BsaI');
  assert.deepEqual(forward, { name: 'BsaI', top: 10, bottom: 14, strand: 1, spans: [{ start: 3, end: 9 }] });
  const reverse = restrictionSites({ bases: 'AAAAAAAAGAGACCAAA', circular: false }).find(site => site.name === 'BsaI');
  assert.deepEqual(reverse, { name: 'BsaI', top: 3, bottom: 7, strand: -1, spans: [{ start: 8, end: 14 }] });
  for (const bases of ['GGTCTCAA', 'GGNCTCAAAAAAAA']) {
    assert.equal(restrictionSites({ bases, circular: false }).some(site => site.name === 'BsaI'), false);
  }
});
