import React from 'react';
import {createRoot} from 'react-dom/client';
import {AppProvider} from '@pero/app-sdk';
import DataAgent from './index';
createRoot(document.getElementById('app')!).render(<AppProvider><DataAgent/></AppProvider>);
