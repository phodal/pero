import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@pero/app-sdk';
import ScientificViewer from './index';
createRoot(document.getElementById('app')!).render(<AppProvider><ScientificViewer /></AppProvider>);
