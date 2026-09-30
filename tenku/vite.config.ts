import { defineConfig } from 'vite';

export default defineConfig({
  // どのパス配下に置いても動くよう相対パスで出力
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
