import { useEffect, useRef } from 'react';
import { useAppContext } from '@pero/app-sdk';
import { mountMoleculeExplorer } from '../../../packages/molecule-viewer/explorer';

export function MolecularExplorer() {
  const root = useRef<HTMLDivElement>(null), explorer = useRef<ReturnType<typeof mountMoleculeExplorer>>(null);
  const { locale, dark } = useAppContext();
  useEffect(() => {
    const mounted = mountMoleculeExplorer(root.current!, { locale, dark });
    explorer.current = mounted;
    return () => { mounted.dispose(); explorer.current = null; };
  }, []);
  useEffect(() => explorer.current?.updateContext({ locale, dark }), [locale, dark]);
  return <div className="default-explorer" ref={root} />;
}
