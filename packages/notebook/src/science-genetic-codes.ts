/** Public NCBI genetic-code facts, version 4.4 (May 2019).
 * https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi
 * Data cross-checked with Biopython 1.86's NCBI transcription. No algorithm is copied.
 * Codon order: nested T,C,A,G at positions 1,2,3. Context-dependent stops remain amino acids.
 */
export interface GeneticCode { id: number; name: string; aminoAcids: string; dualStops: string[] }
export const geneticCodes: readonly GeneticCode[] = [
  {
    "id": 1,
    "name": "Standard",
    "aminoAcids": "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 2,
    "name": "Vertebrate Mitochondrial",
    "aminoAcids": "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 3,
    "name": "Yeast Mitochondrial",
    "aminoAcids": "FFLLSSSSYY**CCWWTTTTPPPPHHQQRRRRIIMMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 4,
    "name": "Mold Mitochondrial; Protozoan Mitochondrial; Coelenterate ",
    "aminoAcids": "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 5,
    "name": "Invertebrate Mitochondrial",
    "aminoAcids": "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSSSVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 6,
    "name": "Ciliate Nuclear; Dasycladacean Nuclear; Hexamita Nuclear",
    "aminoAcids": "FFLLSSSSYYQQCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 9,
    "name": "Echinoderm Mitochondrial; Flatworm Mitochondrial",
    "aminoAcids": "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNNKSSSSVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 10,
    "name": "Euplotid Nuclear",
    "aminoAcids": "FFLLSSSSYY**CCCWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 11,
    "name": "Bacterial, Archaeal and Plant Plastid",
    "aminoAcids": "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 12,
    "name": "Alternative Yeast Nuclear",
    "aminoAcids": "FFLLSSSSYY**CC*WLLLSPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 13,
    "name": "Ascidian Mitochondrial",
    "aminoAcids": "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSGGVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 14,
    "name": "Alternative Flatworm Mitochondrial",
    "aminoAcids": "FFLLSSSSYYY*CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNNKSSSSVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 15,
    "name": "Blepharisma Macronuclear",
    "aminoAcids": "FFLLSSSSYY*QCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 16,
    "name": "Chlorophycean Mitochondrial",
    "aminoAcids": "FFLLSSSSYY*LCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 21,
    "name": "Trematode Mitochondrial",
    "aminoAcids": "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNNKSSSSVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 22,
    "name": "Scenedesmus obliquus Mitochondrial",
    "aminoAcids": "FFLLSS*SYY*LCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 23,
    "name": "Thraustochytrium Mitochondrial",
    "aminoAcids": "FF*LSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 24,
    "name": "Pterobranchia Mitochondrial",
    "aminoAcids": "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSSKVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 25,
    "name": "Candidate Division SR1 and Gracilibacteria",
    "aminoAcids": "FFLLSSSSYY**CCGWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 26,
    "name": "Pachysolen tannophilus Nuclear",
    "aminoAcids": "FFLLSSSSYY**CC*WLLLAPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 27,
    "name": "Karyorelict Nuclear",
    "aminoAcids": "FFLLSSSSYYQQCCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": [
      "TGA"
    ]
  },
  {
    "id": 28,
    "name": "Condylostoma Nuclear",
    "aminoAcids": "FFLLSSSSYYQQCCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": [
      "TAA",
      "TAG",
      "TGA"
    ]
  },
  {
    "id": 29,
    "name": "Mesodinium Nuclear",
    "aminoAcids": "FFLLSSSSYYYYCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 30,
    "name": "Peritrich Nuclear",
    "aminoAcids": "FFLLSSSSYYEECC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 31,
    "name": "Blastocrithidia Nuclear",
    "aminoAcids": "FFLLSSSSYYEECCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": [
      "TAA",
      "TAG"
    ]
  },
  {
    "id": 32,
    "name": "Balanophoraceae Plastid",
    "aminoAcids": "FFLLSSSSYY*WCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG",
    "dualStops": []
  },
  {
    "id": 33,
    "name": "Cephalodiscidae Mitochondrial",
    "aminoAcids": "FFLLSSSSYYY*CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSSKVVVVAAAADDEEGGGG",
    "dualStops": []
  }
];

