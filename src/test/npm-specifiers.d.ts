// The edge functions import npm packages by Deno's specifier. The test suite runs them on
// Node through the alias in vitest.config.ts; this is the same mapping for the app's
// typecheck, which follows the tests' imports into supabase/functions.
declare module "npm:@resvg/resvg-wasm@2.6.2" {
  export * from "@resvg/resvg-wasm";
}
