# Releasing

Releases are made by the **Release** workflow (`.github/workflows/release.yml`). It sets the
version, runs every check, builds the zips, commits and tags `vX.Y.Z` on `main`, creates a
GitHub release, and submits the new version to the Chrome Web Store and Firefox Add-ons.
The stores sign the extension themselves after review.

## Making a release

1. Actions tab → **Release** → **Run workflow**.
2. Choose the version: `patch` (0.1.0 → 0.1.1), `minor` (→ 0.2.0), `major` (→ 1.0.0), or
   an exact number such as `1.2.0`.
3. Optionally add release notes, and untick a store to skip it.
4. Tick **Dry run** the first time. It builds everything and checks the store logins, without
   committing, tagging, or uploading.

Each store has its own job. If one fails after the tag was made, click **Re-run failed jobs**
on the run page. Only that store is retried, with the same zips.

## One-time setup

**The first version goes up by hand.** Neither store's API can create a new listing. Upload
the first zips through each store's dashboard (`npm run zip:all`); the workflow handles every
version after that.

**GitHub environment.** Settings → Environments → New environment → `stores`. Add the
secrets below to it. Optionally add yourself under *Required reviewers*, so each run waits
for your approval before uploading anything.

**Store credentials.** The easiest way to create them is `npx wxt submit init`, which walks
through each store and links to the right pages. It saves them to `.env.submit` (ignored by
git and left out of the sources zip). Copy the values into the `stores` environment, then
delete the file.

| Secret | Where it comes from |
|---|---|
| `CHROME_EXTENSION_ID` | The 32-letter ID in the Chrome Web Store dashboard |
| `CHROME_PUBLISHER_ID` | Chrome Web Store dashboard → Account |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | A Google Cloud service account with the Chrome Web Store API enabled, added to your publisher account |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | That service account's JSON key (the `private_key` value) |
| `FIREFOX_JWT_ISSUER` | addons.mozilla.org → Tools → Manage API Keys |
| `FIREFOX_JWT_SECRET` | Same page |

The Firefox add-on ID (`speedview@mholgatem.github.io`) is public, so it's set in the workflow.

**Pushing to `main`.** The workflow commits the version bump to `main` as `github-actions[bot]`.
If you add branch protection to `main`, allow GitHub Actions to bypass it, or the push fails.
