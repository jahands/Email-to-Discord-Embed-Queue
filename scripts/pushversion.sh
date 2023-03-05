#!/bin/bash

# Push to remote only if there is a single commit ahead of the remote
# (i.e. the commit that was just made by the version script)
branch=$(git branch --show-current)
if [ $(git rev-list --count origin/$branch...$branch) -eq 1 ]; then
  git push
fi
