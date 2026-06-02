# Shadowdark Battle Narrator

A Foundry Virtual Tabletop module for adding narrative texture to Shadowdark combat.

## Local Testing

Foundry loads modules from your user data folder:

```text
%LOCALAPPDATA%\FoundryVTT\Data\modules
```

For development, link this repository into that folder so changes are picked up without copying files.

```powershell
.\scripts\link-module.ps1
```

Then restart Foundry, open a world, and enable **Shadowdark Battle Narrator** in **Manage Modules**.

## GitHub Setup

1. Create a new GitHub repository.
2. Replace `YOUR_GITHUB_USERNAME` in `module.json`.
3. Push this project to GitHub.
4. Create a release tag such as `v0.1.0`.

The included GitHub Actions workflow attaches both `module.json` and `module.zip` to releases.

## Versioning

When publishing a new version:

1. Update `version` in `module.json`.
2. Update the version number in the `download` URL in `module.json`.
3. Commit the change.
4. Tag the release, for example:

```powershell
git tag v0.1.1
git push origin main --tags
```
