#!/usr/bin/env bash
#
# Manage git worktrees for this repo. A new worktree gets its node_modules symlinked from the primary
# checkout, so it is immediately runnable (yarn build / vite / tsx / test) with no fresh install and no
# duplicated gigabyte on disk. `node_modules` is gitignored, so the symlink never shows up in status and
# never blocks removal.
#
#   yarn worktree:new <name> [base]   create ../web-daw-<name> on a new branch <name>, off [base] (default: HEAD)
#   yarn worktree:rm  <name>          remove ../web-daw-<name> (git refuses if it holds uncommitted work)
#   yarn worktree:list                list worktrees
#
# Switching your shell into a worktree cannot be a yarn script: a script runs in a subshell and cannot change
# the directory of the shell that called it. Add this function to your ~/.zshrc instead (tab-completes on the
# worktree name):
#
#   wtcd() { cd "$(git -C ~/Documents/code/web-daw worktree list --porcelain \
#            | sed -n 's/^worktree //p' | grep -E "/web-daw-$1$|/web-daw$" | head -1)"; }
#
# Then `wtcd autolayout` jumps to ../web-daw-autolayout, and `wtcd` with no arg jumps to the primary checkout.

set -euo pipefail

# The primary worktree is the first `git worktree list` entry; it holds the real node_modules to link against.
primary="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
repo_parent="$(dirname "$primary")"
prefix="web-daw-"

path_for() { echo "$repo_parent/$prefix$1"; }

cmd="${1:-list}"
shift || true

case "$cmd" in
new)
  name="${1:?usage: yarn worktree:new <name> [base]}"
  base="${2:-HEAD}"
  dir="$(path_for "$name")"
  if [ -e "$dir" ]; then
    echo "worktree path already exists: $dir" >&2
    exit 1
  fi
  git worktree add -b "$name" "$dir" "$base"
  if [ -d "$primary/node_modules" ]; then
    ln -s "$primary/node_modules" "$dir/node_modules"
    echo "linked node_modules -> $primary/node_modules"
  else
    echo "note: $primary/node_modules not found - run 'yarn install' in the new worktree" >&2
  fi
  echo "created $dir on branch '$name' (base: $base)"
  echo "  cd $dir"
  ;;
rm | remove)
  name="${1:?usage: yarn worktree:rm <name>}"
  dir="$(path_for "$name")"
  git worktree remove "$dir"
  echo "removed $dir (branch '$name' kept - delete it with: git branch -d $name)"
  ;;
list | ls)
  git worktree list
  ;;
*)
  echo "unknown command: $cmd (use: new | rm | list)" >&2
  exit 1
  ;;
esac
