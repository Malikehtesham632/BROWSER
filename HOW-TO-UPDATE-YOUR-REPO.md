# How to update your GitHub repo

I cannot push to your GitHub account, so do these steps on your computer. Open **PowerShell** in the folder that contains your `BROWSER` clone.

## 1. Back up first

```powershell
git -C BROWSER status          # should say "nothing to commit"
git -C BROWSER branch backup-before-cleanup
```

The `backup-before-cleanup` branch keeps your old version, so nothing can be lost.

## 2. Put the cleaned files in

```powershell
cd BROWSER
git checkout -b cleanup
Get-ChildItem -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
Expand-Archive "$HOME\Downloads\BROWSER-clean.zip" -DestinationPath .
Move-Item BROWSER\* . -Force ; Move-Item BROWSER\.[a-z]* . -Force ; Remove-Item BROWSER -Recurse
```

If that last line gives errors, just copy everything (also hidden files like `.github`, `.gitignore`, `.env.example`) from the zip's `BROWSER` folder into your repo folder by hand.

## 3. Check it, then commit

```powershell
npm ci
npm test            # should show: 217 passed
git add -A
git status          # about 100 files; no installer-output folders
git commit -m "Clean up repo, fix tests and CI, recover SearXNG, new Nova UI (v1.1.0)"
```

## 4. Push (pick ONE)

**Option A: normal (safest).** Old history stays, including the big installer files.

```powershell
git push -u origin cleanup      # then open a Pull Request on GitHub and merge it
```

**Option B: fresh history (smallest repo, removes your Windows user name from old files).** Your repo has only one commit, so this is safe if nobody else uses it.

```powershell
git checkout --orphan clean-main
git add -A
git commit -m "Nova Browser 1.1.0"
git branch -M main
git push --force origin main
```

GitHub keeps the old Git LFS installer files in your LFS storage. To free that space, delete them in the repository settings, or create a new empty repository and push there.

## 5. Make the installer

After pushing, on GitHub open **Actions**. Check that **CI** is green. To publish an installer:

```powershell
git tag v1.1.0
git push origin v1.1.0
```

The **Build Windows installer** workflow then builds `Nova Browser-Setup-1.1.0.exe` and attaches it to a GitHub release. Never commit installers.

## 6. Things only you can do

1: Add a `LICENSE` file (for example MIT). Without one, nobody else may legally use your code.
2: If you ever pasted a real API key into a file that was committed, delete that key and create a new one. I scanned the repository and the installers and found **no keys**.
3: Decide about SearXNG privacy (see the README). To keep every search private, put `SEARXNG_ENABLED=false` in your `.env`.
4: Your older v1.0.8 features (session restore, drag-to-reorder tabs, settings page, updater) are saved in `BROWSER-legacy-v1.0.8-recovered-source.zip`. Tell me which ones you want rebuilt.
