/**
 * Type declaration for direct .wasm imports (bundled by wrangler/esbuild).
 * Importing a .wasm file yields a WebAssembly.Module.
 */
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
