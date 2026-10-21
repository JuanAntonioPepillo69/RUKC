/**
 * RUKC · menú de la hoja de la temporada (Google Apps Script).
 *
 *  RUKC → Publicar web             Lee las carpetas de fotos de cada ronda y publica la web.
 *  RUKC → Actualizar fotos y vídeos Solo relee las carpetas (sin publicar), para revisar la pestaña Media.
 *
 * Instalación (una sola vez):
 *  1. En la hoja: Extensiones > Apps Script. Borra lo que haya y pega este archivo. Guarda.
 *  2. En Apps Script: Configuración del proyecto (rueda) > Propiedades del script > Añadir propiedad
 *       nombre: DEPLOY_HOOK_URL
 *       valor:  la URL del Deploy Hook de Vercel (Vercel > proyecto raceupkc > Settings > Git > Deploy Hooks)
 *  3. Recarga la hoja: aparece el menú "RUKC". La primera vez Google pedirá permiso para leer tu Drive
 *     (las carpetas de fotos) y conectarse a Vercel.
 *
 * Fotos y vídeos: en la pestaña Rondas, columna "fotos", pega el enlace de la carpeta de Drive de cada ronda.
 * La carpeta tiene que estar compartida como "Cualquier persona con el enlace: lector".
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('RUKC')
    .addItem('Publicar web', 'publicarWeb')
    .addItem('Actualizar fotos y vídeos', 'actualizarFotos')
    .addToUi();
}

function publicarWeb() {
  const ui = SpreadsheetApp.getUi();
  const hook = PropertiesService.getScriptProperties().getProperty('DEPLOY_HOOK_URL');
  if (!hook) {
    ui.alert('Falta la propiedad DEPLOY_HOOK_URL en Apps Script (Configuración del proyecto > Propiedades del script).');
    return;
  }
  const media = leerCarpetas_();
  if (media.avisos.length) {
    const seguir = ui.alert('Revisa las carpetas de fotos', media.avisos.join('\n\n') + '\n\n¿Publicar igualmente?', ui.ButtonSet.YES_NO);
    if (seguir !== ui.Button.YES) return;
  }
  const res = UrlFetchApp.fetch(hook, { method: 'post', muteHttpExceptions: true });
  if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
    ui.alert('Publicando (' + media.total + ' fotos y vídeos en las galerías). En uno o dos minutos la web mostrará los datos nuevos.\n\nSi no cambia, revisa el último deploy en Vercel: allí aparece qué fila de la hoja tiene un error.');
  } else {
    ui.alert('Vercel respondió con un error (' + res.getResponseCode() + '). Revisa que la URL del Deploy Hook sea correcta.');
  }
}

function actualizarFotos() {
  const media = leerCarpetas_();
  SpreadsheetApp.getUi().alert(media.total + ' fotos y vídeos listados en la pestaña Media.' + (media.avisos.length ? '\n\n' + media.avisos.join('\n\n') : ''));
}

/** Recorre la carpeta de Drive de cada ronda (con sus subcarpetas) y escribe los archivos en la pestaña Media. */
function leerCarpetas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rondas = ss.getSheetByName('Rondas');
  const datos = rondas.getDataRange().getValues();
  const cab = datos[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const colRonda = cab.indexOf('ronda'), colFotos = cab.indexOf('fotos');
  const filas = [], avisos = [];
  if (colFotos < 0) avisos.push('La pestaña Rondas no tiene la columna "fotos".');

  for (let i = 1; colFotos >= 0 && i < datos.length; i++) {
    const ronda = datos[i][colRonda], enlace = String(datos[i][colFotos] || '').trim();
    if (!ronda || !enlace) continue;
    const m = enlace.match(/folders\/([\w-]{10,})/);
    if (!m) { avisos.push('R' + ronda + ': el enlace de "fotos" no es una carpeta de Drive.'); continue; }
    let carpeta;
    try { carpeta = DriveApp.getFolderById(m[1]); } catch (e) { avisos.push('R' + ronda + ': no se puede abrir la carpeta. ¿Es tuya o está compartida contigo?'); continue; }
    const acceso = carpeta.getSharingAccess();
    if (acceso !== DriveApp.Access.ANYONE_WITH_LINK && acceso !== DriveApp.Access.ANYONE) {
      avisos.push('R' + ronda + ': la carpeta "' + carpeta.getName() + '" no está compartida como "Cualquier persona con el enlace". Las fotos no se verán en la web.');
    }
    const archivos = [];
    recorrer_(carpeta, archivos);
    archivos.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es', { numeric: true }); });
    archivos.forEach(function (a) { filas.push([ronda, a.id, a.nombre, a.tipo]); });
  }

  const hoja = ss.getSheetByName('Media') || ss.insertSheet('Media');
  hoja.clearContents();
  hoja.getRange(1, 1, 1, 4).setValues([['ronda', 'id', 'nombre', 'tipo']]);
  if (filas.length) hoja.getRange(2, 1, filas.length, 4).setValues(filas);
  return { total: filas.length, avisos: avisos };
}

function recorrer_(carpeta, out) {
  const files = carpeta.getFiles();
  while (files.hasNext()) {
    const f = files.next(), mime = f.getMimeType();
    if (mime.indexOf('image/') === 0) out.push({ id: f.getId(), nombre: f.getName(), tipo: 'foto' });
    else if (mime.indexOf('video/') === 0) out.push({ id: f.getId(), nombre: f.getName(), tipo: 'video' });
  }
  const subs = carpeta.getFolders();
  while (subs.hasNext()) recorrer_(subs.next(), out);
}
