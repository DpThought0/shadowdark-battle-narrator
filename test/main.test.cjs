const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadModuleApi() {
  const sourcePath = path.join(__dirname, "..", "scripts", "main.js");
  const source = fs.readFileSync(sourcePath, "utf8");
  const createdChatMessages = [];
  const settingValues = {
    manualTagVisibility: "gm",
    killCreditVisibility: "gm",
    moveVisibility: "gm",
    statusVisibility: "gm",
    roundVisibility: "gm",
    sceneVisibility: "gm",
    spellVisibility: "gm",
    natVisibility: "gm",
    initiativeVisibility: "gm",
    combatBoundaryVisibility: "gm",
    playerDownVisibility: "gm",
    defaultVisibility: "gm",
    logPrefix: "Battle Logger"
  };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Hooks: {
      once() {},
      on() {}
    },
    FormApplication: class {},
    foundry: {
      applications: { api: {} },
      utils: {
        hasProperty(object, key) {
          return Object.prototype.hasOwnProperty.call(object || {}, key);
        },
        mergeObject(base, update) {
          return { ...(base || {}), ...(update || {}) };
        }
      }
    },
    game: {
      actors: [],
      combat: null,
      i18n: { localize: value => value },
      messages: [],
      settings: {
        get(moduleId, setting) {
          return settingValues[setting];
        },
        register() {},
        registerMenu() {},
        set() {}
      },
      user: { isGM: false }
    },
    ui: {
      notifications: {
        error() {},
        info() {}
      }
    },
    document: {
      createElement() {
        return createElementStub();
      }
    },
    window: {
      URL: {
        createObjectURL() {
          return "blob:test";
        },
        revokeObjectURL() {}
      }
    },
    Blob: class {},
    ChatMessage: {
      getSpeaker() {
        return { alias: "Shadow" };
      },
      getWhisperRecipients() {
        return [{ id: "gm" }];
      },
      async create(messageData) {
        createdChatMessages.push(messageData);
        return messageData;
      }
    }
  };
  context.game.user.id = "gm";
  context.settingValues = settingValues;
  context.createdChatMessages = createdChatMessages;

  vm.createContext(context);
  vm.runInContext(`${source}
globalThis.__sbnTestApi = {
  buildCleanLogLine,
  cleanExportText,
  compactSpaces,
  detectSpellCast,
  escapeHtml,
  extractAttackDamage,
  getD20Info,
  getInlineTargets,
  getRollMode,
  htmlToText,
  isActorMarkedDead,
  isAttackOrDamageMessage,
  isPlayerTokenMove,
  logInitiativeSummary,
  logRoundMarker,
  logSceneChange,
  objectIncludesDeadMarker
};
globalThis.__sbnTestApi.createdChatMessages = createdChatMessages;`, context, { filename: sourcePath });
  context.__sbnTestApi.settingValues = settingValues;

  return context.__sbnTestApi;
}

function createElementStub() {
  let html = "";

  return {
    set innerHTML(value) {
      html = String(value || "");
    },
    get textContent() {
      return htmlToText(html);
    },
    get innerText() {
      return htmlToText(html);
    },
    querySelector(selector) {
      const selectors = selector.split(",").map(item => item.trim());
      for (const item of selectors) {
        const text = queryText(html, item);
        if (text) return { textContent: text };
      }
      return null;
    }
  };
}

function queryText(html, selector) {
  const classSelector = selector.match(/^\.([\w-]+)$/);
  if (classSelector) {
    const className = classSelector[1];
    const match = html.match(new RegExp(`<[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"));
    return match ? htmlToText(match[1]) : "";
  }

  const tagSelector = selector.match(/(?:^|\s)(h[23])$/i);
  if (tagSelector) {
    const match = html.match(new RegExp(`<${tagSelector[1]}[^>]*>([\\s\\S]*?)<\\/${tagSelector[1]}>`, "i"));
    return match ? htmlToText(match[1]) : "";
  }

  return "";
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function roll({ formula = "1d20", total = 20, results = [20] } = {}) {
  return {
    formula,
    total,
    dice: [
      {
        faces: 20,
        results: results.map(result => ({ result }))
      }
    ]
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const api = loadModuleApi();

test("cleanExportText removes Foundry markup and repeated spell descriptions", () => {
  const first = api.cleanExportText(
    "@UUID[Compendium.shadowdark.spells.Item.web]{Web} Spell Tier 2 Duration: 5 rounds",
    "Web"
  );
  const second = api.cleanExportText("Web Spell Tier 2 Duration: 5 rounds", "Web");
  const macroNoise = api.cleanExportText("Useful note. Thanks for updating the Item Macro for this item.", null);

  assert.equal(first, "Web Spell Tier 2 Duration: 5 rounds");
  assert.equal(second, "");
  assert.equal(macroNoise, "Useful note.");
});

test("getD20Info detects natural rolls and advantage state", () => {
  assert.deepEqual(plain(api.getD20Info({ rolls: [roll({ total: 24, results: [20] })] }, "1d20 + 4")), {
    nat: "NAT20",
    mode: null,
    checkTotal: 24
  });

  assert.equal(
    api.getD20Info({ rolls: [roll({ formula: "2d20kh + 2", total: 19, results: [17, 8] })] }, "2d20kh + 2").mode,
    "ADV"
  );

  assert.equal(
    api.getD20Info({ rolls: [roll({ formula: "2d20kh + 2", total: 19, results: [1, 17] })] }, "2d20kh + 2").nat,
    null
  );

  assert.equal(
    api.getD20Info({ rolls: [roll({ formula: "2d20kh + 2", total: 22, results: [20, 5] })] }, "2d20kh + 2").nat,
    "NAT20"
  );

  assert.equal(
    api.getD20Info({ rolls: [roll({ formula: "2d20kl + 1", total: 6, results: [20, 5] })] }, "2d20kl + 1").nat,
    null
  );

  assert.equal(
    api.getD20Info({ rolls: [roll({ formula: "2d20kl + 1", total: 2, results: [1, 13] })] }, "2d20kl + 1").nat,
    "NAT1"
  );
});

test("extractAttackDamage parses Shadowdark-style attack cards", () => {
  assert.deepEqual(
    plain(api.extractAttackDamage("Longsword 1d20 + 3 17 Damage Roll: 8 Type: Melee")),
    { attack: "17", damage: "8", type: "Melee" }
  );
});

test("buildCleanLogLine creates compact export rows for action cards", () => {
  const message = {
    alias: "Creeg Greythorn",
    content: "<header><h3>Longsword</h3></header><p>1d20 + 3 17 Damage Roll: 8 Type: Melee</p>",
    rolls: [
      roll({ formula: "1d20 + 3", total: 17, results: [14] }),
      { formula: "1d8", total: 8, dice: [{ faces: 8, results: [{ result: 8 }] }] }
    ],
    timestamp: Date.UTC(2026, 0, 1, 12, 0, 0)
  };

  const line = api.buildCleanLogLine(message, 0, [message]);

  assert.match(line, /^\[\d{1,2}:00:00/);
  assert.match(line, /Creeg Greythorn/);
  assert.match(line, /ACTION: Longsword/);
  assert.match(line, /ATTACK: 17/);
  assert.match(line, /DAMAGE: 8/);
  assert.match(line, /TYPE: Melee/);
});

test("logInitiativeSummary waits until every player combatant has rolled", async () => {
  const combat = {
    id: "combat-1",
    round: 1,
    combatants: [
      { id: "creeg", name: "Creeg", initiative: 18, actor: { type: "character" } },
      { id: "smag", name: "Smag", initiative: null, actor: { type: "character" } },
      { id: "goblin", name: "Goblin", initiative: null, actor: { type: "npc" } }
    ]
  };

  await api.logInitiativeSummary(combat);
  assert.equal(api.createdChatMessages.length, 0);

  combat.combatants[1].initiative = 14;
  await api.logInitiativeSummary(combat);

  assert.equal(api.createdChatMessages.length, 1);
  assert.match(api.createdChatMessages[0].content, /Creeg: 18; Smag: 14/);
  assert.doesNotMatch(api.createdChatMessages[0].content, /null/);
});

test("logSceneChange creates a scene-change note", async () => {
  api.createdChatMessages.length = 0;

  await api.logSceneChange({ name: "The Lost Citadel" });

  assert.equal(api.createdChatMessages.length, 1);
  assert.match(api.createdChatMessages[0].content, /TYPE: scene/);
  assert.match(api.createdChatMessages[0].content, /Scene changed to The Lost Citadel\./);
});

test("automated logger messages use the configured narrator speaker", async () => {
  api.createdChatMessages.length = 0;

  await api.logRoundMarker({ id: "combat-1", round: 2 });

  assert.equal(api.createdChatMessages.length, 1);
  assert.equal(api.createdChatMessages[0].speaker.alias, "Battle Logger");
  assert.match(api.createdChatMessages[0].content, /TYPE: round/);
  assert.match(api.createdChatMessages[0].content, /Round 2 begins\./);
});

test("state helpers recognize dead markers and player token movement", () => {
  assert.equal(api.objectIncludesDeadMarker({ statuses: ["defeated"] }), true);
  assert.equal(api.isActorMarkedDead({ system: { attributes: { hp: { value: 0 } } } }, {}), true);
  assert.equal(api.isPlayerTokenMove({ actor: { type: "character" } }, { x: 100 }), true);
  assert.equal(api.isPlayerTokenMove({ actor: { type: "npc" } }, { x: 100 }), false);
});

test("message classification avoids treating attacks as spell logs", () => {
  const attack = {
    content: "Attacking with Longsword Targets Goblin Damage Roll 5",
    rolls: [roll({ formula: "1d20 + 2", total: 15, results: [13] })],
    flags: {}
  };
  const spell = {
    content: "<h3>Web</h3><p>Spell Tier 2 Duration: 5 rounds Range: Near</p>",
    rolls: [],
    flags: { shadowdark: { item: { type: "spell" } } },
    speaker: { alias: "Gwinda" }
  };

  assert.equal(api.isAttackOrDamageMessage(attack, htmlToText(attack.content)), true);
  assert.deepEqual(plain(api.detectSpellCast(spell)), {
    actor: "Gwinda",
    action: "Web",
    note: "Web Spell Tier 2 Duration: 5 rounds Range: Near"
  });
});
