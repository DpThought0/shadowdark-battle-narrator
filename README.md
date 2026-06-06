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

## Battle Tags

When logged in as a GM, open the Token controls and click the feather button to create a battle tag.

Battle tags are posted to Foundry chat in a consistent format:

```text
Battle Logger | TYPE: manual-tag | TAG: #fumble | ACTOR: Tyrex Zot II | ROUND: 2 | NOTE: Threw a spear into the darkness.
```

By default, tags are whispered to GMs so they stay out of player chat while still being present in the chat log for export. Actor and target choices are pulled from the world's Actors list, with manual override fields for one-off names. You can change the default visibility, tag list, and log prefix in the module settings.

Visibility can be configured separately for manual tags, kill credits, movement logs, and status effect logs.

## Automatic Logs

Shadowdark Battle Narrator can remember the last actor who damaged each target. When that target is later marked dead or defeated, the module adds a GM-only kill-credit entry to the chat log.

Automatic kill-credit logging can be turned on or off in the module settings.

The module can also add short GM-only movement entries when character tokens move:

```text
Battle Logger | TYPE: move | ACTOR: Creeg Greythorn
```

Status effects are also logged when applied:

```text
Battle Logger | TYPE: status | ACTOR: Creeg Greythorn | STATUS: Prone
```

When a status effect ends, the module logs that too:

```text
Battle Logger | TYPE: status-ended | ACTOR: Snow Ape | STATUS: Paralyzed
```

## Export

GMs can open **Configure Settings**, find **Shadowdark Battle Narrator**, and use **Export clean battle log** to download a cleaned text export of the current chat log.

## GitHub Setup

Foundry install manifest:

```text
https://github.com/DpThought0/shadowdark-battle-narrator/releases/latest/download/module.json
```

To publish a release, push a version tag such as `v0.1.0`.

The included GitHub Actions workflow attaches both `module.json` and `module.zip` to releases.

## Versioning

When publishing a new version:

1. Update `version` in `module.json`.
2. Update the version number in the `download` URL in `module.json`, keeping the `v` prefix in the release path.
3. Commit the change.
4. Tag the release, for example:

```powershell
git tag v0.1.1
git push origin main
git push origin v0.1.1
```
