#!/usr/bin/env bash
# Move ChatPilot AI into its own GitHub repository, keeping its git history.
# Usage (from anywhere inside this repository):
#   chatpilot/scripts/move-to-own-repo.sh git@github.com:YOUR-ORG/chatpilot-ai.git
# The target repository must exist and be empty. Nothing in this repository is changed except a temporary branch.
set -euo pipefail
target="${1:?Give the URL of the new, empty repository}"
root="$(git rev-parse --show-toplevel)"
cd "$root"
branch="chatpilot-standalone-$(date +%s)"
echo "Extracting chatpilot/ with its history into branch $branch …"
git subtree split --prefix=chatpilot -b "$branch"
echo "Pushing to $target (main) …"
git push "$target" "$branch:main"
git branch -D "$branch" >/dev/null
echo "Done. Clone $target — package.json, src/, public/ and test/ are now at the top level."
echo "Then: npm ci && npm test"
