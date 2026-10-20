/**
 * RUKC · botón "Publicar web" para la hoja de la temporada (Google Apps Script).
 *
 * Instalación (una sola vez):
 *  1. En la hoja: Extensiones > Apps Script. Borra lo que haya y pega este archivo. Guarda.
 *  2. En Apps Script: Configuración del proyecto (rueda) > Propiedades del script > Añadir propiedad
 *       nombre: DEPLOY_HOOK_URL
 *       valor:  la URL del Deploy Hook de Vercel (Vercel > proyecto raceupkc > Settings > Git > Deploy Hooks)
 *  3. Recarga la hoja: aparece el menú "RUKC". La primera vez Google pedirá permiso para conectarse a Vercel.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('RUKC')
    .addItem('Publicar web', 'publicarWeb')
    .addToUi();
}

function publicarWeb() {
  const ui = SpreadsheetApp.getUi();
  const hook = PropertiesService.getScriptProperties().getProperty('DEPLOY_HOOK_URL');
  if (!hook) {
    ui.alert('Falta la propiedad DEPLOY_HOOK_URL en Apps Script (Configuración del proyecto > Propiedades del script).');
    return;
  }
  const res = UrlFetchApp.fetch(hook, { method: 'post', muteHttpExceptions: true });
  if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
    ui.alert('Publicando. En uno o dos minutos la web mostrará los datos nuevos.\n\nSi no cambia, revisa el último deploy en Vercel: allí aparece qué fila de la hoja tiene un error.');
  } else {
    ui.alert('Vercel respondió con un error (' + res.getResponseCode() + '). Revisa que la URL del Deploy Hook sea correcta.');
  }
}
