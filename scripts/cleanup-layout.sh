#!/usr/bin/env bash
# One-shot physical cleanup for the file-structure foundations pass (2026-06-30).
#
# These are directory deletes/renames that could NOT run in the Cowork sandbox
# (its mount denies unlink/rename). Run this from the repo root in your normal
# environment, where file deletion works. Safe + idempotent — each step checks first.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "1/3 · remove empty dead dir data/reports/ …"
[ -d data/reports ] && rm -rf data/reports && echo "   removed" || echo "   already gone"

echo "2/3 · fix typo slug: prospects/bluersoeauto → prospects/blue-rose-auto …"
if [ -d prospects/bluersoeauto ] && [ ! -d prospects/blue-rose-auto ]; then
  mv prospects/bluersoeauto prospects/blue-rose-auto && echo "   renamed (data preserved)"
elif [ -d prospects/blue-rose-auto ]; then
  echo "   target already exists — review prospects/bluersoeauto manually"
else
  echo "   nothing to do"
fi

echo "3/3 · remove stray published hub dir public/reports/bluersoeauto/ …"
# (index.json already de-lists it; canonical public/reports/blue-rose-auto/ remains.)
[ -d public/reports/bluersoeauto ] && rm -rf public/reports/bluersoeauto && echo "   removed" || echo "   already gone"

echo
echo "Done. Optional next (the deferred follow-up): migrate live client/prospect data"
echo "to the new four-bucket layout once skills are rewired onto scripts/lib/paths.js:"
echo "   node scripts/migrate-layout.js --all            # dry run, review first"
echo "   node scripts/migrate-layout.js --all --apply    # perform the moves"
