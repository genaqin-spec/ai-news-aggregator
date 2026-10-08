#!/usr/bin/env bash
set -euo pipefail

# Stage only generated public data, including newly created files. OPML secrets
# and unrelated source changes must never be committed by this workflow.
files=(
  data/latest-24h.json data/latest-7d.json data/archive.json
  data/source-status.json data/waytoagi-7d.json data/title-zh-cache.json
  data/opml-feeds.json
)
for file in "${files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "::error::Missing generated file: $file"
    exit 1
  fi
  bytes=$(wc -c < "$file")
  if (( bytes > 50 * 1024 * 1024 )); then
    echo "::error::$file exceeds the safe 50 MiB commit budget ($bytes bytes)"
    exit 1
  fi
done

git add -- "${files[@]}"
if git diff --cached --quiet -- "${files[@]}"; then
  echo "No data changes to commit"
  exit 0
fi
git config user.name "github-actions-bot"
git config user.email "41898282+github-actions-bot@users.noreply.github.com"
git commit -m "chore: update ai news snapshot" -- "${files[@]}"
# No force push/rebase: an independent upstream fix must never be overwritten.
git push
