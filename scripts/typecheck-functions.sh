#!/usr/bin/env bash
# Typecheck the edge functions.
#
# `tsc` cannot resolve what Deno resolves — the `npm:` / `jsr:` / `https:` specifiers, and the
# `Deno` global — and there is no point pretending otherwise. Those diagnostics are filtered
# out and everything else is a failure, which is enough to catch the class of mistake that has
# actually reached production here: a helper moved to another module and the calls left
# behind, a renamed field, a function called with the wrong arguments.
set -uo pipefail
cd "$(dirname "$0")/.."

out=$(npx tsc --noEmit -p supabase/functions/tsconfig.json 2>&1 \
  | grep -vE "Cannot find module '(npm|jsr|https?):" \
  | grep -vE "Cannot find name 'Deno'" \
  | grep -vE "^$")

if [ -n "$out" ]; then
  echo "$out"
  echo
  echo "✗ edge functions do not typecheck"
  exit 1
fi
echo "✓ edge functions typecheck"
