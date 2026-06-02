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
const ATTACK_TERMS = [
  "attack",
  "attacks",
  "attack roll",
  "weapon attack",
  "melee attack",
  "ranged attack",
  "spell attack"
];
const ATTACK_ACTION_TERMS = [
  "dagger",
  "sword",
  "mace",
  "hammer",
  "axe",
  "spear",
  "bow",
  "crossbow",
  "staff",
  "club",
  "unarmed"
];

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
    icon: "fa-solid fa-feather-pointed",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    onChange: () => openBattleTagDialog()
  };
});

Hooks.on("createChatMessage", message => {
  if (!game.user?.isGM || !game.settings.get(MODULE_ID, "autoLogAttacks")) return;
  if (message.flags?.[MODULE_ID]) return;

  const attack = detectAttackMessage(message);
  if (!attack) return;

  void postAutomatedLog({
    type: "attack",
    actor: attack.actor,
    target: attack.target,
    item: attack.item,
    rollTotal: attack.rollTotal,
    note: attack.note
  });
});

function registerSettings() {
  game.settings.register(MODULE_ID, "defaultVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.DefaultVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.DefaultVisibility.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      gm: "SHADOWDARK_BATTLE_NARRATOR.Visibility.GM",
      public: "SHADOWDARK_BATTLE_NARRATOR.Visibility.Public"
    },
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

  game.settings.register(MODULE_ID, "autoLogAttacks", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogAttacks.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogAttacks.Hint",
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
  const defaultVisibility = game.settings.get(MODULE_ID, "defaultVisibility");
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
  await createLoggerChatMessage(entry.type, {
    ...entry,
    visibility: "gm"
  }, "gm");
}

async function createLoggerChatMessage(type, entry, visibility) {
  const prefix = game.settings.get(MODULE_ID, "logPrefix") || "Battle Logger";
  const round = game.combat?.round ?? "";
  const turn = game.combat?.combatant?.name ?? "";
  const fields = [
    ["TYPE", type],
    ["TAG", entry.tag],
    ["ACTOR", entry.actor],
    ["TARGET", entry.target],
    ["ITEM", entry.item],
    ["ROLL", entry.rollTotal],
    ["ROUND", round],
    ["TURN", turn],
    ["VISIBILITY", visibility],
    ["NOTE", entry.note]
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

function detectAttackMessage(message) {
  const speakerActor = getSpeakerActor(message);
  const contentText = htmlToText(message.content);
  const flavorText = htmlToText(message.flavor);
  const text = `${flavorText} ${contentText}`.trim();
  const lowerText = text.toLocaleLowerCase();
  const rolls = getMessageRolls(message);
  const hasD20 = rolls.some(roll => rollContainsD20(roll)) || /\b\d*d20(?:kh|kl)?\b/i.test(text);
  const attackTerm = ATTACK_TERMS.find(term => lowerText.includes(term));
  const action = getFieldValue(text, "ACTION");
  const check = getFieldValue(text, "CHECK");
  const item = getMessageItemName(message, text);
  const isDamageOnly = looksLikeDamageOnlyMessage(lowerText, hasD20, check);
  const looksLikeAttack = !isDamageOnly && (
    Boolean(attackTerm && (hasD20 || rolls.length === 0))
    || Boolean(action && check)
    || Boolean(action && hasD20 && looksLikeAttackAction(action))
    || Boolean(item && hasD20)
  );

  if (!looksLikeAttack) return null;

  return {
    actor: speakerActor?.name || message.speaker?.alias || message.user?.name || "Unknown Actor",
    target: getTargetName(message) || getInlineTarget(text),
    item: item || action,
    rollTotal: getPrimaryRollTotal(rolls) || check || getInlineD20Total(text),
    note: text.slice(0, 180)
  };
}

function getSpeakerActor(message) {
  if (message.speaker?.actor) return game.actors?.get(message.speaker.actor);
  if (message.actor) return message.actor;
  return null;
}

function getTargetName(message) {
  const targets = message.flags?.shadowdark?.targets
    || message.flags?.core?.targets
    || message.flags?.midiqol?.targets
    || [];
  const names = Array.from(targets)
    .map(target => target?.name || target?.actor?.name || game.actors?.get(target?.actorId)?.name)
    .filter(Boolean);

  return names.join(", ");
}

function getMessageItemName(message, text) {
  const itemId = message.flags?.shadowdark?.itemId
    || message.flags?.core?.itemId
    || message.flags?.dnd5e?.item?.id;
  const actor = getSpeakerActor(message);
  const item = itemId ? actor?.items?.get(itemId) : null;
  if (item?.name) return item.name;

  const action = getFieldValue(text, "ACTION");
  if (action) return action;

  const title = text.match(/^(.*?)\s*(?:attack|attacks|attack roll)/i)?.[1]?.trim();
  return title && title.length <= 80 ? title : "";
}

function getMessageRolls(message) {
  if (Array.isArray(message.rolls)) return message.rolls;
  if (message.roll) return [message.roll];
  return [];
}

function getPrimaryRollTotal(rolls) {
  const roll = rolls.find(candidate => Number.isFinite(Number(candidate?.total))) || rolls[0];
  return roll?.total ?? "";
}

function rollContainsD20(roll) {
  const formula = String(roll?.formula || "").toLocaleLowerCase();
  if (formula.includes("d20")) return true;

  return Array.from(roll?.dice ?? []).some(die => die?.faces === 20);
}

function looksLikeDamageOnlyMessage(text, hasD20, check) {
  if (hasD20 || check) return false;
  return text.includes("damage") || /\b\d+d(?:4|6|8|10|12)\b/i.test(text);
}

function looksLikeAttackAction(action) {
  const actionText = action.toLocaleLowerCase();
  return ATTACK_ACTION_TERMS.some(term => actionText.includes(term));
}

function getFieldValue(text, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`\\b${escapedField}:\\s*([^|]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function getInlineTarget(text) {
  const match = text.match(/\bTargets?\s+(.+?)(?:\s*\||$)/i);
  return match?.[1]?.trim() || "";
}

function getInlineD20Total(text) {
  const rollMatch = text.match(/\b\d*d20(?:kh|kl)?(?:\s*[+-]\s*\d+)?\s*=\s*(\d+)/i);
  if (rollMatch?.[1]) return rollMatch[1];

  const check = getFieldValue(text, "CHECK");
  return check;
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
