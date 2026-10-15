# Nova Browser network patch

## Important compatibility note

This patch is intended for the supplied Omni-Engine-Provider-Layer-v10.3 source snapshot. It replaces the existing provider, search and configuration files at their current paths.

## Apply using the Windows PowerShell script (recommended)

1. Extract this ZIP into its own folder, for example `%USERPROFILE%\Downloads\NovaBrowser-Network-Fix-Patch`.
2. Open PowerShell in your Nova Browser project root (the folder containing `package.json`).
3. Run the script from the folder where you extracted this ZIP. If it was extracted into the example path, run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\NovaBrowser-Network-Fix-Patch\Apply-NovaBrowser-Network-Fix.ps1" -ProjectRoot (Get-Location).Path
   ```

   If you used another extraction folder, replace that script path with your actual path.

The script overwrites only the listed source/config/test files and first makes backups of existing copies in a `.nova-browser-patch-backup-<timestamp>` folder within the project. It does not modify your actual `.env` file or your dependencies.

## Verify the SearXNG export

From the project root:

```powershell
Select-String -Path .\src\providers\searxng.js -Pattern 'export function createSearxngProvider'
```

This must return a matching line. If it does not, the new provider file has not been applied.

## Run focused tests

```powershell
node --test tests/provider-network-fixes.test.js tests/search-providers.test.js tests/searxng.test.js tests/config.test.js
```

The patch's source files were overlaid onto the supplied diagnostic snapshot in a clean test copy: all 24 tests in that focused command passed in that environment. This does not prove live API keys or public SearXNG instances work; those require testing from your machine.

## Environment

If your actual `.env` contains `PROVIDER_TIMEOUT_MS=4000`, change only that value to `8000` for this test. Do not replace or upload your `.env` file. The `.env.example` is safe to replace with the sample in this patch.
