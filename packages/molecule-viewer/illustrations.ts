// Idealized illustrations, not measured structures or optimized conformers.
export type Atom = { element: 'C' | 'H' | 'O'; position: [number, number, number] };
type Bond = readonly [number, number, 1 | 2];
export type MoleculeIllustration = { id: string; zh: string; en: string; formula: string; atoms: Atom[]; bonds: Bond[] };
export const molecules: readonly MoleculeIllustration[] = [
  { id:'water', zh:'水', en:'Water', formula:'H₂O', atoms:[
    {element:'O',position:[0,0,0]}, {element:'H',position:[-.8,-.6,0]}, {element:'H',position:[.8,-.6,0]}
  ], bonds:[[0,1,1],[0,2,1]] },
  { id:'ethanol', zh:'乙醇', en:'Ethanol', formula:'C₂H₆O', atoms:[
    {element:'C',position:[-.8,0,0]}, {element:'C',position:[.65,0,0]}, {element:'O',position:[1.35,1.1,0]},
    {element:'H',position:[2.2,.9,.1]}, {element:'H',position:[-1.3,-.55,.8]}, {element:'H',position:[-1.3,-.55,-.8]},
    {element:'H',position:[-1.2,.95,0]}, {element:'H',position:[.95,-.55,-.85]}, {element:'H',position:[.95,-.6,.85]}
  ], bonds:[[0,1,1],[1,2,1],[2,3,1],[0,4,1],[0,5,1],[0,6,1],[1,7,1],[1,8,1]] },
  { id:'benzene', zh:'苯', en:'Benzene', formula:'C₆H₆', atoms:[...Array.from({length:6},(_,i):Atom=>({element:'C',position:[Math.cos(i*Math.PI/3)*1.15,Math.sin(i*Math.PI/3)*1.15,0]})),...Array.from({length:6},(_,i):Atom=>({element:'H',position:[Math.cos(i*Math.PI/3)*2.05,Math.sin(i*Math.PI/3)*2.05,0]}))], bonds:[...Array.from({length:6},(_,i):Bond=>[i,(i+1)%6,i%2===0?2:1]),...Array.from({length:6},(_,i):Bond=>[i,i+6,1])] }
];

export const defaultMolecule = molecules[1];
