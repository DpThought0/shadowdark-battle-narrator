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
const loggedRounds = new Set();
const loggedNats = new Set();
const loggedInitiative = new Set();
const downedPlayers = new Set();
const activeStatusByEffect = new Map();
const initiativeTimers = new Map();
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
  if (!game.user?.isGM) return;
  if (message.flags?.[MODULE_ID]) return;

  if (game.settings.get(MODULE_ID, "autoLogKills")) rememberDamage(message);
  if (game.settings.get(MODULE_ID, "autoLogNats")) logNatHighlight(message);
  if (game.settings.get(MODULE_ID, "autoLogSpells")) logSpellCast(message);
});

Hooks.on("updateActor", (actor, changes) => {
  if (!game.user?.isGM) return;

  if (game.settings.get(MODULE_ID, "autoLogPlayerDown")) {
    void logPlayerDownRecovery(actor);
  }

  if (!isPlayerActor(actor) && game.settings.get(MODULE_ID, "autoLogKills") && isActorMarkedDead(actor, changes)) {
    void logKillCredit(actor);
  }
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
  if (!game.user?.isGM) return;

  if (game.settings.get(MODULE_ID, "autoLogKills") && combatant.defeated) {
    void logKillCredit(combatant.actor, combatant.token);
  }

  if (game.settings.get(MODULE_ID, "autoLogInitiative") && Number.isFinite(Number(combatant.initiative))) {
    scheduleInitiativeSummary(combatant.combat);
  }
});

Hooks.on("updateCombat", (combat, changes) => {
  if (!game.user?.isGM || !game.settings.get(MODULE_ID, "autoLogRounds")) return;
  if (!hasOwn(changes, "round")) return;

  void logRoundMarker(combat);
});

Hooks.on("createCombat", combat => {
  if (!game.user?.isGM || !game.settings.get(MODULE_ID, "autoLogCombatBoundaries")) return;

  void postAutomatedLog({
    type: "combat-start",
    round: combat?.round || 1,
    note: "Combat starts."
  });
});

Hooks.on("deleteCombat", combat => {
  if (!game.user?.isGM || !game.settings.get(MODULE_ID, "autoLogCombatBoundaries")) return;

  void postAutomatedLog({
    type: "combat-end",
    round: combat?.round || "",
    note: "Combat ends."
  });
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

Hooks.once("init", () => {
  void loadTemplates([
    "modules/shadowdark-battle-narrator/templates/automation-settings.hbs",
    "modules/shadowdark-battle-narrator/templates/export-log.hbs"
  ]);
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
    config: false,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "killCreditVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.KillCreditVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.KillCreditVisibility.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "moveVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.MoveVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.MoveVisibility.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "statusVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.StatusVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.StatusVisibility.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "roundVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.RoundVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.RoundVisibility.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "spellVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.SpellVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.SpellVisibility.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "natVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.NatVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.NatVisibility.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "initiativeVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.InitiativeVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.InitiativeVisibility.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "combatBoundaryVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.CombatBoundaryVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.CombatBoundaryVisibility.Hint",
    scope: "world",
    config: false,
    type: String,
    choices: VISIBILITY_CHOICES,
    default: "gm"
  });

  game.settings.register(MODULE_ID, "playerDownVisibility", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.PlayerDownVisibility.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.PlayerDownVisibility.Hint",
    scope: "world",
    config: false,
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
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoLogMoves", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogMoves.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogMoves.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoLogStatuses", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogStatuses.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogStatuses.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoLogRounds", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogRounds.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogRounds.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoLogSpells", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogSpells.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogSpells.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoLogNats", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogNats.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogNats.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoLogInitiative", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogInitiative.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogInitiative.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoLogPlayerDown", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogPlayerDown.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogPlayerDown.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoLogCombatBoundaries", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogCombatBoundaries.Name",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutoLogCombatBoundaries.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.registerMenu(MODULE_ID, "automationSettings", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutomationMenu.Name",
    label: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutomationMenu.Label",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.AutomationMenu.Hint",
    icon: "fa-solid fa-sliders",
    type: AutomationSettingsForm,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "exportCleanLog", {
    name: "SHADOWDARK_BATTLE_NARRATOR.Settings.ExportCleanLog.Name",
    label: "SHADOWDARK_BATTLE_NARRATOR.Settings.ExportCleanLog.Label",
    hint: "SHADOWDARK_BATTLE_NARRATOR.Settings.ExportCleanLog.Hint",
    icon: "fa-solid fa-file-export",
    type: CleanLogExporter,
    restricted: true
  });
}

class CleanLogExporter extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "shadowdark-battle-narrator-export",
      title: game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Export.Title"),
      template: `modules/${MODULE_ID}/templates/export-log.hbs`,
      width: 420,
      height: "auto",
      closeOnSubmit: false
    });
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-action='download']").on("click", () => {
      exportCleanLog();
      this.close();
    });
  }

  async _updateObject() {}
}

class AutomationSettingsForm extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "shadowdark-battle-narrator-automation-settings",
      title: game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Settings.AutomationMenu.Name"),
      template: `modules/${MODULE_ID}/templates/automation-settings.hbs`,
      width: 640,
      height: "auto",
      closeOnSubmit: true
    });
  }

  getData() {
    return {
      choices: [
        { value: "gm", label: game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Visibility.GM") },
        { value: "public", label: game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Visibility.Public") }
      ],
      sections: getAutomationSections().map(section => ({
        ...section,
        enabled: section.enabledSetting ? game.settings.get(MODULE_ID, section.enabledSetting) : true,
        visibility: game.settings.get(MODULE_ID, section.visibilitySetting)
      }))
    };
  }

  async _updateObject(event, formData) {
    for (const section of getAutomationSections()) {
      if (section.enabledSetting) {
        await game.settings.set(MODULE_ID, section.enabledSetting, Boolean(formData[section.enabledSetting]));
      }

      await game.settings.set(MODULE_ID, section.visibilitySetting, formData[section.visibilitySetting] || "gm");
    }
  }
}

function getAutomationSections() {
  return [
    {
      key: "manual",
      label: "SHADOWDARK_BATTLE_NARRATOR.Automation.Manual.Label",
      description: "SHADOWDARK_BATTLE_NARRATOR.Automation.Manual.Description",
      visibilitySetting: "manualTagVisibility"
    },
    {
      key: "moves",
      label: "SHADOWDARK_BATTLE_NARRATOR.Automation.Moves.Label",
      description: "SHADOWDARK_BATTLE_NARRATOR.Automation.Moves.Description",
      enabledSetting: "autoLogMoves",
      visibilitySetting: "moveVisibility"
    },
    {
      key: "statuses",
      label: "SHADOWDARK_BATTLE_NARRATOR.Automation.Statuses.Label",
      description: "SHADOWDARK_BATTLE_NARRATOR.Automation.Statuses.Description",
      enabledSetting: "autoLogStatuses",
      visibilitySetting: "statusVisibility"
    },
    {
      key: "nats",
      label: "SHADOWDARK_BATTLE_NARRATOR.Automation.Nats.Label",
      description: "SHADOWDARK_BATTLE_NARRATOR.Automation.Nats.Description",
      enabledSetting: "autoLogNats",
      visibilitySetting: "natVisibility"
    },
    {
      key: "combatBoundaries",
      label: "SHADOWDARK_BATTLE_NARRATOR.Automation.CombatBoundaries.Label",
      description: "SHADOWDARK_BATTLE_NARRATOR.Automation.CombatBoundaries.Description",
      enabledSetting: "autoLogCombatBoundaries",
      visibilitySetting: "combatBoundaryVisibility"
    },
    {
      key: "initiative",
      label: "SHADOWDARK_BATTLE_NARRATOR.Automation.Initiative.Label",
      description: "SHADOWDARK_BATTLE_NARRATOR.Automation.Initiative.Description",
      enabledSetting: "autoLogInitiative",
      visibilitySetting: "initiativeVisibility"
    },
    {
      key: "rounds",
      label: "SHADOWDARK_BATTLE_NARRATOR.Automation.Rounds.Label",
      description: "SHADOWDARK_BATTLE_NARRATOR.Automation.Rounds.Description",
      enabledSetting: "autoLogRounds",
      visibilitySetting: "roundVisibility"
    },
    {
      key: "spells",
      label: "SHADOWDARK_BATTLE_NARRATOR.Automation.Spells.Label",
      description: "SHADOWDARK_BATTLE_NARRATOR.Automation.Spells.Description",
      enabledSetting: "autoLogSpells",
      visibilitySetting: "spellVisibility"
    },
    {
      key: "kills",
      label: "SHADOWDARK_BATTLE_NARRATOR.Automation.Kills.Label",
      description: "SHADOWDARK_BATTLE_NARRATOR.Automation.Kills.Description",
      enabledSetting: "autoLogKills",
      visibilitySetting: "killCreditVisibility"
    },
    {
      key: "playerDown",
      label: "SHADOWDARK_BATTLE_NARRATOR.Automation.PlayerDown.Label",
      description: "SHADOWDARK_BATTLE_NARRATOR.Automation.PlayerDown.Description",
      enabledSetting: "autoLogPlayerDown",
      visibilitySetting: "playerDownVisibility"
    }
  ];
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
    ["ACTION", entry.action],
    ["ITEM", entry.item],
    ["DAMAGE", entry.damage],
    ["HP", entry.hp],
    ["ROLL", entry.rollTotal],
    ["ROUND", entry.round ?? round],
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
    speaker: getLogSpeaker(type, entry),
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

function getLogSpeaker(type, entry) {
  if (type !== "move") return ChatMessage.getSpeaker();

  const actor = findActorByName(entry.actor);
  if (actor) return ChatMessage.getSpeaker({ actor });

  return { alias: entry.actor || game.user?.name || "Battle Logger" };
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

async function logPlayerDownRecovery(actor) {
  if (!isPlayerActor(actor)) return;

  const hp = getActorHpValue(actor);
  if (!Number.isFinite(hp)) return;

  if (hp <= 0) {
    if (downedPlayers.has(actor.id)) return;

    downedPlayers.add(actor.id);
    await postAutomatedLog({
      type: "downed",
      actor: actor.name,
      hp,
      note: `${actor.name} is down.`
    });
    return;
  }

  if (!downedPlayers.has(actor.id)) return;

  downedPlayers.delete(actor.id);
  await postAutomatedLog({
    type: "recovered",
    actor: actor.name,
    hp,
    note: `${actor.name} is back up.`
  });
}

async function logRoundMarker(combat) {
  const round = combat?.round;
  if (!round) return;

  const roundKey = `${combat.id}:${round}`;
  if (loggedRounds.has(roundKey)) return;

  loggedRounds.add(roundKey);
  await postAutomatedLog({
    type: "round",
    round,
    note: `Round ${round} begins.`
  });
}

function logSpellCast(message) {
  const spell = detectSpellCast(message);
  if (!spell) return;

  void postAutomatedLog({
    type: "spell",
    actor: spell.actor,
    action: spell.action,
    note: spell.note
  });
}

function logNatHighlight(message) {
  const d20Info = getD20Info(message, stripHtml(message.content));
  if (!d20Info.nat) return;

  const key = `${message.id || getMessageTime(message)}:${d20Info.nat}`;
  if (loggedNats.has(key)) return;

  loggedNats.add(key);
  void postAutomatedLog({
    type: "highlight",
    tag: d20Info.nat === "NAT20" ? "#crit" : "#fumble",
    actor: getSpeakerActor(message)?.name || getMessageSpeaker(message),
    action: getCardTitle(message.content) || getFieldValue(stripHtml(message.content), "ACTION"),
    rollTotal: d20Info.nat,
    note: d20Info.nat === "NAT20" ? "Natural 20." : "Natural 1."
  });
}

function scheduleInitiativeSummary(combat) {
  if (!combat) return;

  const key = combat.id;
  if (initiativeTimers.has(key)) window.clearTimeout(initiativeTimers.get(key));

  initiativeTimers.set(key, window.setTimeout(() => {
    initiativeTimers.delete(key);
    void logInitiativeSummary(combat);
  }, 1000));
}

async function logInitiativeSummary(combat) {
  if (!combat) return;

  const playerCombatants = Array.from(combat.combatants ?? [])
    .filter(combatant => isPlayerCombatant(combatant))
    .filter(combatant => Number.isFinite(Number(combatant.initiative)));
  if (!playerCombatants.length) return;

  const combatantIds = playerCombatants
    .map(combatant => combatant.id)
    .sort()
    .join(",");
  const key = `${combat.id}:${combat.round ?? 0}:${combatantIds}`;
  if (loggedInitiative.has(key)) return;

  loggedInitiative.add(key);
  const summary = playerCombatants
    .sort((left, right) => Number(right.initiative) - Number(left.initiative))
    .map(combatant => `${combatant.name}: ${combatant.initiative}`)
    .join("; ");

  await postAutomatedLog({
    type: "initiative",
    actor: "Players",
    note: summary
  });
}

function isPlayerCombatant(combatant) {
  const actor = combatant.actor;
  return isPlayerActor(actor);
}

function detectSpellCast(message) {
  const rawText = stripHtml(message.content);
  const text = compactSpaces(rawText);
  const lowerText = text.toLocaleLowerCase();
  const action = getCardTitle(message.content) || getFieldValue(text, "ACTION");
  if (lowerText.startsWith("battle logger |")) return null;
  if (!action) return null;
  if (isAttackOrDamageMessage(message, text)) return null;
  if (!looksLikeSpellCast(message, text, action)) return null;

  return {
    actor: getSpeakerActor(message)?.name || getMessageSpeaker(message),
    action,
    note: text.slice(0, 180)
  };
}

function looksLikeSpellCast(message, text, action) {
  const lowerText = text.toLocaleLowerCase();
  const lowerAction = action.toLocaleLowerCase();
  const itemType = getMessageItemType(message);
  if (itemType === "spell") return true;
  if (lowerText.includes("spell") || lowerText.includes("tier ")) return true;
  if (lowerText.includes("duration:") || lowerText.includes("range:")) return true;
  if (/^(web|light|cure wounds|holy weapon|mage armor|charm person|turn undead)$/i.test(action)) return true;
  return lowerAction.includes("spell");
}

function isAttackOrDamageMessage(message, text) {
  const lowerText = text.toLocaleLowerCase();
  const rolls = getMessageRolls(message);
  if (lowerText.includes("attack roll") || lowerText.includes("damage roll")) return true;
  if (lowerText.includes("attacking with")) return true;
  if (rolls.some(roll => rollContainsD20(roll)) && lowerText.includes("targets")) return true;
  return /\b(?:1d20|2d20kh|2d20kl)\b/i.test(text) && /\bdamage\b/i.test(text);
}

function getMessageItemType(message) {
  const itemType = message.flags?.shadowdark?.item?.type
    || message.flags?.shadowdark?.itemType
    || message.flags?.core?.item?.type
    || message.flags?.dnd5e?.item?.type;
  if (itemType) return String(itemType).toLocaleLowerCase();

  const itemId = message.flags?.shadowdark?.itemId || message.flags?.core?.itemId || message.flags?.dnd5e?.item?.id;
  const item = itemId ? getSpeakerActor(message)?.items?.get(itemId) : null;
  return item?.type ? String(item.type).toLocaleLowerCase() : "";
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
    round: "roundVisibility",
    "combat-start": "combatBoundaryVisibility",
    "combat-end": "combatBoundaryVisibility",
    spell: "spellVisibility",
    highlight: "natVisibility",
    initiative: "initiativeVisibility",
    downed: "playerDownVisibility",
    recovered: "playerDownVisibility",
    manual: "manualTagVisibility"
  }[type] || "manualTagVisibility";

  return game.settings.get(MODULE_ID, setting) || game.settings.get(MODULE_ID, "defaultVisibility") || "gm";
}

function exportCleanLog() {
  const messages = Array.from(game.messages)
    .sort((left, right) => getMessageTime(left) - getMessageTime(right));
  const lines = messages
    .map((message, index) => buildCleanLogLine(message, index, messages))
    .filter(Boolean);

  saveText(lines.join("\n"), "foundry-battle-narrator-log.txt");
}

function buildCleanLogLine(message, index, messages) {
  const time = new Date(getMessageTime(message)).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
  const speaker = getMessageSpeaker(message);
  const rawText = stripHtml(message.content);
  const action = getCardTitle(message.content);
  const rolls = getExportRolls(message);
  const cleaned = cleanExportText(rawText, action);
  const attackInfo = extractAttackDamage(rawText);
  const d20Info = getD20Info(message, rawText);

  if (!cleaned && !action && rolls.length === 0) return null;
  if (/Thanks for updating the Item Macro/i.test(rawText)) return null;

  const parts = [`[${time}] ${speaker}`];
  const initiative = isLikelyInitiativeCluster(index, messages);

  if (initiative && rolls.length === 1 && /^-?\d+$/.test(compactSpaces(rawText))) {
    parts.push(`INITIATIVE: ${rolls[0].total}`);
    return parts.join(" | ");
  }

  if (action) parts.push(`ACTION: ${action}`);
  if (d20Info.mode) parts.push(d20Info.mode);
  if (d20Info.nat) parts.push(d20Info.nat);
  if (attackInfo.attack) parts.push(`ATTACK: ${attackInfo.attack}`);
  if (attackInfo.damage) parts.push(`DAMAGE: ${attackInfo.damage}`);
  if (attackInfo.type) parts.push(`TYPE: ${attackInfo.type}`);

  const isAttackCard = attackInfo.attack || attackInfo.damage;
  if (!isAttackCard && d20Info.checkTotal !== null) parts.push(`CHECK: ${d20Info.checkTotal}`);
  if (rolls.length > 0 && !isAttackCard && d20Info.checkTotal === null) {
    parts.push(`ROLLS: ${rolls.map(roll => `${roll.formula} = ${roll.total}`).join("; ")}`);
  }
  if (cleaned && cleaned !== action) parts.push(`TEXT: ${cleaned}`);

  return parts.join(" | ");
}

function saveText(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const link = document.createElement("a");
  link.download = filename || "foundry-battle-narrator-log.txt";
  link.href = window.URL.createObjectURL(blob);
  link.click();
  window.URL.revokeObjectURL(link.href);
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent || div.innerText || "";
}

function compactSpaces(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function getCardTitle(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  const selectors = [".item-name", ".card-header h3", ".card-header h2", "header h3", "header h2", "h3", "h2"];

  for (const selector of selectors) {
    const element = div.querySelector(selector);
    const text = compactSpaces(element?.textContent);
    if (text) return text;
  }

  return null;
}

function getExportRolls(message) {
  if (!message.rolls || message.rolls.length === 0) return [];

  return message.rolls.map(roll => ({
    formula: roll.formula || "roll",
    total: roll.total ?? null
  }));
}

function getRollMode(message, text) {
  const formulas = (message.rolls || []).map(roll => roll.formula || "").join(" ");
  const combined = `${formulas} ${compactSpaces(text)}`;
  if (/\b2d20kh\b/i.test(combined)) return "ADV";
  if (/\b2d20kl\b/i.test(combined)) return "DIS";
  if (/\b2d20\b/i.test(combined) && /\bkh\b/i.test(combined)) return "ADV";
  if (/\b2d20\b/i.test(combined) && /\bkl\b/i.test(combined)) return "DIS";
  return null;
}

function getD20Info(message, text) {
  const cleaned = compactSpaces(text);
  const formulas = (message.rolls || []).map(roll => roll.formula || "").join(" ");
  const combined = `${formulas} ${cleaned}`;
  const d20s = [];

  for (const roll of message.rolls || []) {
    for (const die of roll.dice || []) {
      if (die.faces !== 20) continue;
      for (const result of die.results || []) {
        if (typeof result.result === "number") d20s.push(result.result);
      }
    }
  }

  if (d20s.length === 0) {
    const twoD20Match = cleaned.match(/\b2d20k[hl]\b[^0-9-]*.*?\b(20|1|[2-9]|1[0-9])\s+(20|1|[2-9]|1[0-9])\b/i);
    const oneD20Match = cleaned.match(/\b1d20\b[^0-9-]*.*?\b(20|1|[2-9]|1[0-9])\s+\1\b/i);
    if (twoD20Match) {
      d20s.push(Number.parseInt(twoD20Match[1], 10));
      d20s.push(Number.parseInt(twoD20Match[2], 10));
    } else if (oneD20Match) {
      d20s.push(Number.parseInt(oneD20Match[1], 10));
    }
  }

  const nat = d20s.includes(20) ? "NAT20" : d20s.includes(1) ? "NAT1" : null;
  const mode = getRollMode(message, text);
  let checkTotal = null;

  if (/\b(?:1d20|2d20kh|2d20kl)\b/i.test(combined) && !/Damage Roll/i.test(cleaned)) {
    if (message.rolls?.length === 1 && typeof message.rolls[0].total === "number") {
      checkTotal = message.rolls[0].total;
    } else {
      const numbers = cleaned.match(/-?\d+/g);
      if (numbers?.length) checkTotal = Number.parseInt(numbers[numbers.length - 1], 10);
    }
  }

  return { nat, mode, checkTotal };
}

function extractAttackDamage(text) {
  const cleaned = compactSpaces(text);
  const attackMatch = cleaned.match(/(?:^|\s)(?:1d20|2d20kh|2d20kl).*?\s(-?\d+)\s+Damage Roll/i);
  const damageMatch = cleaned.match(/Damage Roll:?.*?\s(-?\d+)(?:\s+Type:|\s*$)/i);
  const typeMatch = cleaned.match(/Type:\s*(Melee|Ranged)/i);

  return {
    attack: attackMatch ? attackMatch[1] : null,
    damage: damageMatch ? damageMatch[1] : null,
    type: typeMatch ? typeMatch[1] : null
  };
}

function cleanExportText(text, action) {
  const output = compactSpaces(text)
    .replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1")
    .replace(/Thanks for updating the Item Macro.*$/i, "")
    .trim();
  if (/Damage Roll/i.test(output) && action) return "";
  return output;
}

function isLikelyInitiativeCluster(index, messages) {
  return false;
}

function getMessageSpeaker(message) {
  return message.alias || message.speaker?.alias || message.user?.name || "Unknown";
}

function getMessageTime(message) {
  return new Date(message.timestamp || message.time || message._source?.timestamp || Date.now()).getTime();
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
  if (!isPlayerActor(actor)) return false;

  return hasOwn(changes, "x")
    || hasOwn(changes, "y")
    || hasOwn(changes, "elevation")
    || foundry.utils?.hasProperty?.(changes, "x")
    || foundry.utils?.hasProperty?.(changes, "y")
    || foundry.utils?.hasProperty?.(changes, "elevation");
}

function isPlayerActor(actor) {
  return Boolean(actor && (actor.type === "character" || actor.hasPlayerOwner));
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
  const actor = findActorByName(name);
  return actor?.id || "";
}

function findActorByName(name) {
  const normalized = normalizeName(name);
  return Array.from(game.actors ?? []).find(candidate => normalizeName(candidate.name) === normalized);
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
