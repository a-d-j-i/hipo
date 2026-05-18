# @hipo/backup-github

`BackupTarget` implementation backed by the GitHub Contents API. Pushes a single
rolling `backup.bin` file (configurable path) to a repo of the user's choice;
reads it back on restore.

## Auth

Fine-grained personal access token with `Contents: Read and write` on the target
repo. Tokens are passed in as a string — this package doesn't persist them; the
app stores them wherever its secret-storage policy says (browser:
passphrase-derived encryption + IndexedDB; Tauri: OS keyring).

## Usage

```ts
import { githubTarget } from "@hipo/backup-github";

const target = githubTarget({
  owner: "alice",
  repo: "hipo-backups",
  token: "github_pat_…",
  // optional
  path: "backup.bin",
  branch: "main",
  authorName: "hipo",
  authorEmail: "bot@example.com",
});

await target.put(sealedBlob);
const blob = await target.get();
```

## Limits

GitHub Contents API allows files up to 100 MB but recommends < 1 MB for
performance. For hipo-sized backups (single-digit MB) this is fine. If a
consumer ever needs larger, the right path is the Git Database API (tree +
blob + commit), not LFS — left as a future enhancement.

Not LFS — keeping the backup as a plain repo file is cheaper and avoids the LFS
quota.
