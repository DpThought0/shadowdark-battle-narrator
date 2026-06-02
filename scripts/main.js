const MODULE_ID = "shadowdark-battle-narrator";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);
});

Hooks.once("ready", () => {
  if (!game.user?.isGM) return;

  ui.notifications.info(game.i18n.localize("SHADOWDARK_BATTLE_NARRATOR.Ready"));
});
