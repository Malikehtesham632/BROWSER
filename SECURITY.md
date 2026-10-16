# Security

## Reporting a problem

Please open a private security advisory on GitHub (Security tab, "Report a vulnerability"), or contact the repository owner directly. Do not post details in a public issue.

## Keys and secrets

1: Keep API keys in `.env` (or in `%APPDATA%\Nova Browser\.env` for the installed app). `.env` is ignored by git.
2: Never commit `.env`, crawl data, or reports. If a key was ever committed or shared, treat it as leaked: create a new key and delete the old one.
3: The installer and the interface never contain API keys.

## What the desktop app protects

1: Web pages run in sandboxed views with no access to Node.js and no access to the interface.
2: Pages cannot navigate or redirect to non-web addresses.
3: Pages must ask before using your location, notifications, camera or microphone. Everything else is blocked.
4: The interface follows a strict content security policy and never builds HTML from page text.

## Running the server

The server listens on `127.0.0.1` by default. It refuses to start on any other address unless `OMNI_API_TOKEN` is set.
