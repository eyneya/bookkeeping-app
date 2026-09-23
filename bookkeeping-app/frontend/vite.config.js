import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Bolt supplies the real Supabase credentials through the process environment
  // of the dev/build command. Vite does not expose process.env to
  // import.meta.env on its own, so surface them explicitly here, falling back
  // to any .env file at the project root.
  const fileEnv = loadEnv(mode, path.resolve(__dirname, '../../'), '');
  const supabaseUrl = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY || '';

  return {
    plugins: [react()],
    server: {
      host: true,
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
  };
});
