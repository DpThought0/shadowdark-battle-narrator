const MODULE_ID = "codex-foundry-module";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);
});

Hooks.once("ready", () => {
  if (!game.user?.isGM) return;

  ui.notifications.info(game.i18n.localize("CODEX_FOUNDRY_MODULE.Ready"));
});
