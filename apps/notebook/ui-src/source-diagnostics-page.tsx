import { createRoot } from 'react-dom/client';
import { AppProvider } from '@pero/app-sdk';
import { NotebookSourceDiagnostics } from './source-diagnostics';
createRoot(document.getElementById('app')!).render(<AppProvider><NotebookSourceDiagnostics /></AppProvider>);
