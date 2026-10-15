import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/korona-gor-polskich/',
  plugins: [react()],
});
