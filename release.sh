#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

TARGET_BRANCH="master"
PACKAGE_JSON="package.json"
PACKAGE_LOCK="package-lock.json"

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required."
  exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: release.sh must be run inside a git repository."
  exit 1
fi

if [ ! -f "$PACKAGE_JSON" ]; then
  echo "ERROR: Could not find $PACKAGE_JSON."
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"

if [ -z "$CURRENT_BRANCH" ]; then
  echo "ERROR: Detached HEAD is not supported for releases."
  exit 1
fi

if ! git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
  echo "ERROR: Target branch '$TARGET_BRANCH' does not exist locally."
  exit 1
fi

if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
  echo "ERROR: Merge in progress. Resolve it before releasing."
  exit 1
fi

if [ -d ".git/rebase-merge" ] || [ -d ".git/rebase-apply" ]; then
  echo "ERROR: Rebase in progress. Resolve it before releasing."
  exit 1
fi

restore_branch() {
  git checkout "$CURRENT_BRANCH" >/dev/null 2>&1 || true
}

trap restore_branch EXIT

CURRENT_VERSION="$(node -p "require('./$PACKAGE_JSON').version")"

if [ -z "${1:-}" ]; then
  NEW_VERSION="$(
    CURRENT_VERSION="$CURRENT_VERSION" node - <<'EOF'
const { execSync } = require('child_process');

const semverPattern = /^\d+\.\d+\.\d+$/;
const currentVersion = process.env.CURRENT_VERSION;

if (!semverPattern.test(currentVersion)) {
  console.error(`ERROR: Current version '${currentVersion}' is not semantic versioning compatible.`);
  process.exit(1);
}

const parseVersion = value => value.split('.').map(Number);

const compareVersions = (left, right) => {
  const a = parseVersion(left);
  const b = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }

  return 0;
};

const incrementPatch = value => {
  const [major, minor, patch] = parseVersion(value);
  return `${major}.${minor}.${patch + 1}`;
};

const tagOutput = execSync('git tag --list "v*"', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .map(tag => tag.trim().replace(/^v/, ''))
  .filter(tag => semverPattern.test(tag));

const latestVersion = [currentVersion, ...tagOutput].sort(compareVersions).pop();
process.stdout.write(incrementPatch(latestVersion));
EOF
  )"
else
  NEW_VERSION="$1"
fi

if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: Version must be in x.y.z format."
  exit 1
fi

TAG_NAME="v$NEW_VERSION"

if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null 2>&1; then
  echo "ERROR: Tag $TAG_NAME already exists locally."
  exit 1
fi

if git ls-remote --tags origin "refs/tags/$TAG_NAME" | grep -q "$TAG_NAME"; then
  echo "ERROR: Tag $TAG_NAME already exists on origin."
  exit 1
fi

git fetch --tags origin "$TARGET_BRANCH"

if [ "$CURRENT_BRANCH" = "$TARGET_BRANCH" ]; then
  git merge --ff-only "origin/$TARGET_BRANCH"
fi

echo "Releasing $NEW_VERSION from branch $CURRENT_BRANCH"

node - "$NEW_VERSION" "$PACKAGE_JSON" "$PACKAGE_LOCK" <<'EOF'
const fs = require('fs');

const [version, packageJsonPath, packageLockPath] = process.argv.slice(2);

const updateVersion = filePath => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  content.version = version;

  if (filePath.endsWith('package-lock.json') && content.packages && content.packages['']) {
    content.packages[''].version = version;
  }

  fs.writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`);
};

updateVersion(packageJsonPath);
updateVersion(packageLockPath);
EOF

git add -A

if git diff --cached --quiet; then
  echo "ERROR: No changes to commit for release."
  exit 1
fi

git commit -m "Release v$NEW_VERSION"

git checkout "$TARGET_BRANCH" >/dev/null 2>&1
git merge --ff-only "origin/$TARGET_BRANCH"
git merge --ff-only "$CURRENT_BRANCH"
git tag -a "$TAG_NAME" -m "Version $NEW_VERSION"
git push origin "$TARGET_BRANCH" "$TAG_NAME"

echo "SUCCESS: Released $TAG_NAME from $CURRENT_BRANCH via $TARGET_BRANCH."
