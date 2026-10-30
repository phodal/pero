import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ worker: {format:'es'}, base: './', server: { host: '127.0.0.1' }, build: {
  target: 'esnext',
  rollupOptions: { input: process.env.PERO_READER_ONLY === '1'
    ? { reader: resolve(import.meta.dirname, 'reader.html') }
    : process.env.PERO_CHAT_ONLY === '1'
    ? { chat: resolve(import.meta.dirname, 'chat.html') }
    : { workbench: resolve(import.meta.dirname, 'index.html'), chat: resolve(import.meta.dirname, 'chat.html'), reader: resolve(import.meta.dirname, 'reader.html') } },
} });
