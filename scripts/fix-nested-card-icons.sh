#!/usr/bin/env bash
# Repairs the nested-card icon bug across the marketing site.
#
# Bug: feature/problem grids in landing pages used <div class="card"><i class="fa-...">
# as the icon container. Because `.card` is the full feature-card style (3rem padding,
# blurred white bg, 24px radius, hover lift, ::before accent strip), every icon
# rendered as a giant card-inside-a-card. The intended class is `.card-icon-wrapper`
# (64x64 blue rounded tile).
#
# This script rewrites only the inner wrapper — outer `.card` divs are followed by
# another `<div>` and stay untouched.
#
# Usage:  bash scripts/fix-nested-card-icons.sh
#         bash scripts/fix-nested-card-icons.sh --check   # report only, no writes

set -euo pipefail

cd "$(dirname "$0")/.."

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

FILES=$(grep -rln --include="*.html" '<div class="card">' . | grep -v node_modules | grep -v platform/ | sort)

total=0
file_count=0
for f in $FILES; do
  file_count=$((file_count + 1))
  hits=$(grep -A1 '<div class="card">' "$f" | grep -c '<i class="fa-' || true)
  if [[ "$hits" -gt 0 ]]; then
    printf "%3d  %s\n" "$hits" "$f"
    total=$((total + hits))
    if [[ "$CHECK_ONLY" -eq 0 ]]; then
      perl -i -0pe 's|<div class="card">(\s*\n\s*<i class="fa-)|<div class="card-icon-wrapper">$1|g' "$f"
    fi
  fi
done

if [[ "$total" -eq 0 ]]; then
  echo "No nested-card icon bugs found."
elif [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo
  echo "Found $total occurrence(s). Re-run without --check to fix."
else
  echo
  echo "Fixed $total occurrence(s) across $file_count scanned file(s)."
fi
