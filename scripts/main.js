const MODULE_ID = "shadowdark-battle-narrator";
const DEFAULT_TAGS = [
  "#kill",
  "#crit",
  "#fumble",
  "#clutch",
  "#nearDeath",
  "#bigSave",
  "#bossDamage",
  "#badIdea",
  "#heroMoment",
  "#comment"
];
const lastDamageByTarget = new Map();
const loggedKills = new Set();
const loggedMoves = new Set();
const loggedStatuses = new Set();
const activeStatusByEffect = new Map();
const VISIBILITY_CHOICES = {
  gm: "SHADOWDARK_BATTLE_NARRATOR.Visibility.GM",
  public: "SHADOWDARK_BATTLE_NARRATOR.Visibility.Public"
};

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);
  registerSettings();
});

Hooks.once("ready", () => {
  if (!game.user?.isGM) return;

  ui.notifications.info(game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Ready"));
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user?.isGM || !controls.tokens?.tools) return;

  controls.tokens.tools.shadowdarkBattleNarrator = {
    name: "shadowdarkBattleNarrator",
    title: "SHADOWDARK_BATTLE_NARRATOR.Controls.BattleTag",
    icon: "fa-solid fa-pen-nib",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    onChange: () => openBattleTagDialog()
  };
});

Hooks.on("createChatMessage", message => {
  if (!game.user?.isGM || !game.settings.get(MODULE_ID, "autoLogKills")) return;
  if (message.flags?.[MODULE_ID]) return;

  rememberDamage(message);
});

Hooks.on("updateActor", (actor, changes) => {
  if (!game.user?.isGM || !game.settings.get(MODULE_ID, "autoLogKills")) return;
  if (!isActorMarkedDead(actor, changes)) return;

  void logKillCredit(actor);
});

Hooks.on("updateToken", (...args) => {
  if (!game.user?.isGM) return;

  const { token, changes } = getTokenUpdateContext(args);
  if (!token || !changes) return;

  if (game.settings.get(MODULE_ID, "autoLogMoves") && isPlayerTokenMove(token, changes)) {
    void logMove(token);
  }

  if (game.settings.get(MODULE_ID, "autoLogKills") && isTokenMarkedDead(token, changes)) {
    void logKillCredit(getTokenActor(token), token);
  }
});

Hooks.on("updateCombatant", combatant => {
  if (!game.user?.isGM || !game.settings.get(MODULE_ID, "autoLogKills")) return;
  if (!combatant.defeated) return;

  void logKillCredit(combatant.actor, combatant.token);
});

Hooks.on("createActiveEffect", effect => {
  if (!game.user?.isGM) return;

  handleEffectChange(effect);
});

Hooks.on("updateActiveEffect", effect => {
  if (!game.user?.isGM) return;

  handleEffectChange(effect);
});

Hooks.on("deleteActiveEffect", effect => {
  if (!game.user?.isGM) return;

  handleEffectRemoval(effect);
});

function registerSettings() {
  game.settings.register(MODULE_ID, "defaultVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.DefaultVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.DefaultVisibility.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "manualTagVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.ManualTagVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.ManualTagVisibility.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "killCreditVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.KillCreditVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.KillCreditVisibility.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "moveVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.MoveVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.MoveVisibility.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "statusVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.StatusVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.StatusVisibility.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "logPrefix", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.LogPrefix.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.LogPrefix.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "Battle Logger"
  });

  game.settings.register(MODULE_ID, "tags", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.Tags.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.Tags.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_TAGS.join(", ")
  });

  game.settings.register(MODULE_ID, "autoLogKills", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogKills.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogKills.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoLogMoves", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogMoves.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogMoves.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoLogStatuses", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogStatuses.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogStatuses.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

async function openBattleTagDialog() {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) {
    ui.notifications.error(game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Errors.DialogUnavailable"));
    return;
  }

  let entry;
  try {
    entry = await DialogV2.prompt({
      window: { title: "SHADOWDARK_BATTLE_NARRATOR.Dialog.Title" },
      content: buildBattleTagForm(),
      ok: {
        label: "SHADOWDARK_BATTLE_NARRATOR.Dialog.Save",
        callback: (event, button) => collectBattleTagForm(button.form)
      },
      rejectClose: false,
      modal: false
    });
  } catch {
    return;
  }

  if (!entry) return;
  await postBattleTag(entry);
}

function buildBattleTagForm() {
  const defaultVisibility = getConfiguredVisibility("manual");
  const tagOptions = getSettingList("tags").map(tag => optionHtml(tag, tag));
  const actorOptions = getActorChoices("actor").map(actor => optionHtml(actor.name, actor.name));
  const targetOptions = getActorChoices("target").map(actor => optionHtml(actor.name, actor.name));

  return `
    <form class="shadowdark-battle-narrator-form">
      <div class="form-group">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.Tag")}</label>
        <select name="tag" autofocus>${tagOptions}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.Actor")}</label>
        <select name="actor">
          ${optionHtml("", game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.ActorPlaceholder"))}
          ${actorOptions}
        </select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.OtherActor")}</label>
        <input name="otherActor" type="text" placeholder="${escapeHtml(game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.OtherActorPlaceholder"))}">
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.Target")}</label>
        <select name="target">
          ${optionHtml("", game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.TargetPlaceholder"))}
          ${targetOptions}
        </select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.OtherTarget")}</label>
        <input name="otherTarget" type="text" placeholder="${escapeHtml(game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.OtherTargetPlaceholder"))}">
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.Visibility")}</label>
        <select name="visibility">
          <option value="gm" ${defaultVisibility === "gm" ? "selected" : ""}>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Visibility.GM")}</option>
          <option value="public" ${defaultVisibility === "public" ? "selected" : ""}>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Visibility.Public")}</option>
        </select>
      </div>
      <div class="form-group stacked">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.Note")}</label>
        <textarea name="note" rows="4"></textarea>
      </div>
    </form>
  `;
}

function collectBattleTagForm(form) {
  const formData = new FormData(form);
  const actor = String(formData.get("otherActor") || formData.get("actor") || "").trim();
  const target = String(formData.get("otherTarget") || formData.get("target") || "").trim();
  const entry = {
    tag: String(formData.get("tag") || "").trim(),
    actor,
    target,
    visibility: String(formData.get("visibility") || "gm"),
    note: String(formData.get("note") || "").trim()
  };

  if (!entry.tag || !entry.actor) {
    ui.notifications.warn(game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Errors.MissingRequired"));
    return null;
  }

  return entry;
}

async function postBattleTag(entry) {
  await createLoggerChatMessage("manual-tag", entry, entry.visibility);
}

async function postAutomatedLog(entry) {
  const visibility = entry.visibility || getConfiguredVisibility(entry.type);
  await createLoggerChatMessage(entry.type, {
    ...entry,
    visibility
  }, visibility);
}

async function createLoggerChatMessage(type, entry, visibility) {
  const prefix = game.settings.get(MODULE_ID, "logPrefix") || "Battle Logger";
  const round = game.combat?.round ?? "";
  const turn = game.combat?.combatant?.name ?? "";
  const contextFields = entry.compact ? [] : [
    ["TARGET", entry.target],
    ["ITEM", entry.item],
    ["DAMAGE", entry.damage],
    ["ROLL", entry.rollTotal],
    ["ROUND", round],
    ["TURN", turn],
    ["VISIBILITY", visibility],
    ["NOTE", entry.note]
  ];
  const fields = [
    ["TYPE", type],
    ["TAG", entry.tag],
    ["ACTOR", entry.actor],
    ["STATUS", entry.status],
    ...contextFields
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
  const line = [prefix, ...fields.map(([key, value]) => `${key}: ${value}`)].join(" | ");
  const content = `<p class="shadowdark-battle-narrator-log">${escapeHtml(line)}</p>`;
  const messageData = {
    content,
    speaker: ChatMessage.getSpeaker(),
    flags: {
      [MODULE_ID]: {
        ...entry,
        type,
        round,
        turn,
        visibility,
        createdBy: game.user.id
      }
    }
  };

  if (visibility === "gm") {
    messageData.whisper = ChatMessage.getWhisperRecipients("GM").map(user => user.id);
  }

  await ChatMessage.create(messageData);
}

function rememberDamage(message) {
  const contentText = htmlToText(message.content);
  const flavorText = htmlToText(message.flavor);
  const text = `${flavorText} ${contentText}`.trim();
  const lowerText = text.toLocaleLowerCase();
  if (!lowerText.includes("damage roll") && !/\bdamage\b/i.test(text)) return;

  const sourceActor = getSpeakerActor(message);
  const source = sourceActor?.name || message.speaker?.alias || message.user?.name || "Unknown Actor";
  const targets = getTargetEntries(message, text);
  const damage = getDamageTotal(message, text);
  const action = getFieldValue(text, "ACTION") || getInlineAction(text);

  if (!targets.length || !damage) return;

  for (const target of targets) {
    const record = {
      source,
      sourceActorId: sourceActor?.id || "",
      target: target.name,
      targetActorId: target.actorId || "",
      damage,
      action,
      messageId: message.id,
      timestamp: Date.now()
    };

    for (const key of getDamageKeys(target.name, target.actorId)) {
      lastDamageByTarget.set(key, record);
    }
  }
}

async function logKillCredit(actor, token) {
  if (!actor) return;

  const targetName = token?.name || actor.name;
  const targetActorId = actor.id;
  const killKey = token?.id ? `token:${token.id}` : `actor:${targetActorId}`;
  if (loggedKills.has(killKey)) return;

  const damage = findLastDamage(targetName, targetActorId);
  if (!damage) return;

  loggedKills.add(killKey);
  await postAutomatedLog({
    type: "kill-credit",
    tag: "#kill",
    actor: damage.source,
    target: targetName,
    damage: damage.damage,
    item: damage.action,
    note: `${damage.source} last damaged ${targetName}.`
  });
}

async function logMove(token) {
  const actor = getTokenActor(token);
  if (!actor) return;

  const moveKey = getMoveKey(actor);
  if (moveKey && loggedMoves.has(moveKey)) return;

  if (moveKey) loggedMoves.add(moveKey);
  await postAutomatedLog({
    type: "move",
    actor: actor.name || token.name,
    compact: true
  });
}

function handleEffectChange(effect) {
  const actor = getEffectActor(effect);
  if (game.settings.get(MODULE_ID, "autoLogKills") && objectIncludesDeadMarker(effect)) {
    void logKillCredit(actor);
    return;
  }

  if (!game.settings.get(MODULE_ID, "autoLogStatuses")) return;

  const status = getEffectName(effect);
  if (!actor || !status || isDeadStatusName(status)) return;

  const statusKey = `${actor.id}:${effect.id || status}:${status}`;
  if (loggedStatuses.has(statusKey)) return;

  loggedStatuses.add(statusKey);
  rememberActiveStatus(effect, actor, status);
  void postAutomatedLog({
    type: "status",
    actor: actor.name,
    status,
    compact: true
  });
}

function handleEffectRemoval(effect) {
  if (!game.settings.get(MODULE_ID, "autoLogStatuses")) return;

  const remembered = activeStatusByEffect.get(effect.uuid || effect.id);
  const actor = getEffectActor(effect) || remembered?.actor;
  const status = getEffectName(effect) || remembered?.status;
  if (!actor || !status || isDeadStatusName(status)) return;

  activeStatusByEffect.delete(effect.uuid || effect.id);
  void postAutomatedLog({
    type: "status-ended",
    actor: actor.name,
    status,
    compact: true
  });
}

function rememberActiveStatus(effect, actor, status) {
  const key = effect.uuid || effect.id;
  if (!key) return;

  activeStatusByEffect.set(key, { actor, status });
}

function getConfiguredVisibility(type) {
  const setting = {
    "kill-credit": "killCreditVisibility",
    move: "moveVisibility",
    status: "statusVisibility",
    "status-ended": "statusVisibility",
    manual: "manualTagVisibility"
  }[type] || "manualTagVisibility";

  return game.settings.get(MODULE_ID, setting) || game.settings.get(MODULE_ID, "defaultVisibility") || "gm";
}

function isActorMarkedDead(actor, changes) {
  const hpValue = getActorHpValue(actor);
  if (Number.isFinite(hpValue) && hpValue <= 0) return true;

  return objectIncludesDeadMarker(changes)
    || objectIncludesDeadMarker(actor.statuses)
    || objectIncludesDeadMarker(actor.effects?.contents);
}

function isTokenMarkedDead(token, changes) {
  return objectIncludesDeadMarker(changes)
    || objectIncludesDeadMarker(token.statuses)
    || objectIncludesDeadMarker(getTokenActor(token)?.statuses)
    || objectIncludesDeadMarker(getTokenActor(token)?.effects?.contents);
}

function isPlayerTokenMove(token, changes) {
  const actor = getTokenActor(token);
  if (!actor || (actor.type !== "character" && !actor.hasPlayerOwner)) return false;

  return hasOwn(changes, "x")
    || hasOwn(changes, "y")
    || hasOwn(changes, "elevation")
    || foundry.utils?.hasProperty?.(changes, "x")
    || foundry.utils?.hasProperty?.(changes, "y")
    || foundry.utils?.hasProperty?.(changes, "elevation");
}

function getMoveKey(actor) {
  const combat = game.combat;
  if (!combat) return "";

  return [
    combat.id,
    combat.round ?? 0,
    combat.turn ?? 0,
    actor.id
  ].join(":");
}

function getEffectActor(effect) {
  const parent = effect?.parent;
  if (parent?.documentName === "Actor" || parent?.constructor?.documentName === "Actor") return parent;
  if (parent?.actor) return parent.actor;
  if (effect?.actor) return effect.actor;
  return null;
}

function getEffectName(effect) {
  const firstStatus = effect?.statuses instanceof Set ? Array.from(effect.statuses)[0] : "";
  return effect?.name || effect?.label || firstStatus || "";
}

function isDeadStatusName(status) {
  return objectIncludesDeadMarker(status);
}

function getTokenUpdateContext(args) {
  const [first, second, third] = args;
  if (isTokenLike(first)) return { token: first, changes: second };
  if (isTokenLike(second)) return { token: second, changes: third };

  return { token: null, changes: null };
}

function isTokenLike(value) {
  return Boolean(value?.actor || value?.actorId || value?.documentName === "Token" || value?.constructor?.documentName === "Token");
}

function getTokenActor(token) {
  if (token?.actor) return token.actor;
  if (token?.actorId) return game.actors?.get(token.actorId);
  return null;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function getActorHpValue(actor) {
  const candidates = [
    actor?.system?.attributes?.hp?.value,
    actor?.system?.hp?.value,
    actor?.system?.health?.value,
    actor?.system?.attributes?.health?.value
  ];
  const value = candidates.find(candidate => Number.isFinite(Number(candidate)));
  return value === undefined ? null : Number(value);
}

function objectIncludesDeadMarker(value) {
  const text = flattenForSearch(value).toLocaleLowerCase();
  return text.includes("dead")
    || text.includes("defeated")
    || text.includes("unconscious")
    || text.includes("incapacitated");
}

function flattenForSearch(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Set) return Array.from(value).map(item => flattenForSearch(item, depth + 1)).join(" ");
  if (Array.isArray(value)) return value.map(item => flattenForSearch(item, depth + 1)).join(" ");
  if (typeof value === "object") {
    return Object.values(value).map(item => flattenForSearch(item, depth + 1)).join(" ");
  }
  return "";
}

function findLastDamage(targetName, actorId) {
  const matches = getDamageKeys(targetName, actorId)
    .map(key => lastDamageByTarget.get(key))
    .filter(Boolean);

  return matches.sort((left, right) => right.timestamp - left.timestamp)[0] || null;
}

function getDamageKeys(name, actorId) {
  return [
    actorId ? `actor:${actorId}` : "",
    name ? `name:${normalizeName(name)}` : ""
  ].filter(Boolean);
}

function getTargetEntries(message, text) {
  const entries = [];
  const targets = message.flags?.shadowdark?.targets
    || message.flags?.core?.targets
    || message.flags?.midiqol?.targets
    || [];

  for (const target of Array.from(targets)) {
    const actorId = target?.actorId || target?.actor?.id || "";
    const name = target?.name || target?.actor?.name || game.actors?.get(actorId)?.name;
    if (name) entries.push({ name, actorId });
  }

  for (const name of getInlineTargets(text)) {
    entries.push({
      name,
      actorId: findActorIdByName(name)
    });
  }

  return dedupeTargets(entries);
}

function getDamageTotal(message, text) {
  const rolls = getMessageRolls(message);
  const damageRoll = rolls.find(roll => !rollContainsD20(roll) && Number.isFinite(Number(roll?.total)));
  if (damageRoll) return damageRoll.total;

  const explicit = text.match(/\bDamage Roll\s+(\d+)/i);
  if (explicit?.[1]) return explicit[1];

  const rollTotal = text.match(/\b\d+d(?:4|6|8|10|12)(?:\s*[+-]\s*\d+)?\s*=\s*(\d+)/i);
  return rollTotal?.[1] || "";
}

function getInlineAction(text) {
  const match = text.match(/\b(?:Attacking with|Damage from)\s+(.+?)(?:\s+Damage Roll|\s+Targets|\s*\||$)/i);
  return match?.[1]?.trim() || "";
}

function getInlineTargets(text) {
  const match = text.match(/\bTargets?\s+(.+?)(?:\s*\||$)/i);
  if (!match?.[1]) return [];

  return match[1]
    .split(/,\s*|;\s*/)
    .map(name => name.trim())
    .filter(Boolean);
}

function dedupeTargets(targets) {
  const seen = new Set();
  return targets.filter(target => {
    const key = target.actorId || normalizeName(target.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findActorIdByName(name) {
  const normalized = normalizeName(name);
  const actor = Array.from(game.actors ?? []).find(candidate => normalizeName(candidate.name) === normalized);
  return actor?.id || "";
}

function normalizeName(name) {
  return String(name || "").trim().toLocaleLowerCase();
}

function getSpeakerActor(message) {
  if (message.speaker?.actor) return game.actors?.get(message.speaker.actor);
  if (message.actor) return message.actor;
  return null;
}

function getMessageRolls(message) {
  if (Array.isArray(message.rolls)) return message.rolls;
  if (message.roll) return [message.roll];
  return [];
}

function rollContainsD20(roll) {
  const formula = String(roll?.formula || "").toLocaleLowerCase();
  if (formula.includes("d20")) return true;

  return Array.from(roll?.dice ?? []).some(die => die?.faces === 20);
}

function getFieldValue(text, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`\\b${escapedField}:\\s*([^|]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function htmlToText(value) {
  const html = String(value || "");
  const element = document.createElement("div");
  element.innerHTML = html;
  return (element.textContent || element.innerText || "").replace(/\s+/g, " ").trim();
}

function getSettingList(setting) {
  return String(game.settings.get(MODULE_ID, setting) || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function getActorChoices(role) {
  const actors = Array.from(game.actors ?? []);
  const characters = actors.filter(actor => actor.type === "character");
  const nonCharacters = actors.filter(actor => actor.type !== "character");
  const preferred = role === "actor" ? characters : nonCharacters;
  const fallback = role === "actor" ? nonCharacters : characters;
  const names = [
    ...sortActorsByName(preferred),
    ...sortActorsByName(fallback)
  ]
    .filter(actor => actor?.name)
    .map(actor => ({ name: actor.name, type: actor.type || "" }));

  if (role === "actor") names.unshift({ name: "Whole Party", type: "party" });

  return dedupeActors(names);
}

function sortActorsByName(actors) {
  return [...actors].sort((left, right) => left.name.localeCompare(right.name));
}

function dedupeActors(actors) {
  const seen = new Set();
  return actors.filter(actor => {
    const key = actor.name.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function optionHtml(value, label) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
