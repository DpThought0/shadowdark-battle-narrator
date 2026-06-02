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
const DEFAULT_ROSTER = [
  "Smag",
  "Calder Vey",
  "Tyrex Zot II",
  "Magni Jotunblod",
  "Gwinda the Good Lich",
  "Goodboy the Terrible",
  "Whole Party",
  "Enemy / Other"
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

  game.settings.register(MODULE_ID, "roster", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.Roster.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.Roster.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_ROSTER.join(", ")
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
  const rosterOptions = getSettingList("roster").map(name => optionHtml(name, name));

  return `
    <form class="shadowdark-battle-narrator-form">
      <div class="form-group">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.Tag")}</label>
        <select name="tag" autofocus>${tagOptions}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.Actor")}</label>
        <select name="actor">${rosterOptions}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.OtherActor")}</label>
        <input name="otherActor" type="text" placeholder="${escapeHtml(game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.OtherActorPlaceholder"))}">
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Dialog.Target")}</label>
        <input name="target" type="text">
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
  const entry = {
    tag: String(formData.get("tag") || "").trim(),
    actor,
    target: String(formData.get("target") || "").trim(),
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
  const prefix = game.settings.get(MODULE_ID, "logPrefix") || "Battle Logger";
  const round = game.combat?.round ?? "";
  const turn = game.combat?.combatant?.name ?? "";
  const fields = [
    ["TYPE", "manual-tag"],
    ["TAG", entry.tag],
    ["ACTOR", entry.actor],
    ["TARGET", entry.target],
    ["ROUND", round],
    ["TURN", turn],
    ["VISIBILITY", entry.visibility],
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
        type: "manual-tag",
        round,
        turn,
        createdBy: game.user.id
      }
    }
  };

  if (entry.visibility === "gm") {
    messageData.whisper = ChatMessage.getWhisperRecipients("GM").map(user => user.id);
  }

  await ChatMessage.create(messageData);
}

function getSettingList(setting) {
  return String(game.settings.get(MODULE_ID, setting) || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
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
