// Calibración: réplicas de slides T1 existentes con sus mismos datos, para comparar lado a lado
const S = require('../slides.cjs');
const rows = [
  [4, 23, 'Julio Benitez', '42.044'], [5, 44, 'Daniel Domínguez', '41.829'], [6, 77, 'Alfredo Reyes', '41.566'],
  [7, '04', 'Gonzalo Vergara', '40.733'], [8, 92, 'Rafael Fortes', '41.421'], [9, 72, 'Raúl Gonzalez', '40.796'],
  [10, 45, 'Fran Peña', '40.938'], [11, '01', 'Cristóbal Corral', '40.991'], [12, 19, 'Álvaro Gomez', '42.425'],
  [13, 12, 'Amir Kustafi', '42.280'], [14, 27, 'Cristóbal', '43.076'], [15, 13, 'Carlos', '45.440'], [16, 58, 'Javier Cabello', '47.195'],
].map(([pos, dorsal, name, best]) => ({ pos, dorsal, name, best }));
const top = [['RAFAEL LOZANO', 70], ['ELIEZER DANIELES', 50], ['FRAN PEÑA', 42], ['MANUEL MAÑERO', 35], ['GONZALO VERGARA', 26], ['PABLO RÍOS', 25],
  ['JULIO BENITEZ', 24], ['ADRIÁN MORENO', 19], ['LUCAS PINTO', 18], ['ARON PETERZENS', 16]].map(([name, pts], i) => ({ pos: i + 1, name, pts }));
const l1130 = [['RAÚL GONZALEZ', 16], ['DANIEL DOMÍNGUEZ', 11], ['ALFREDO REYES', 9], ['RAFAEL FORTES', 9], ['JOHN FORTES', 8], ['JOSE MIGUEL', 8],
  ['JULIO BAUTISTA', 6], ['SAMUEL CESAR', 6], ['CRISTÓBAL CORRAL', 5], ['ÁLVARO GOMEZ', 5], ['JOSE MARÍA', 4], ['FERNANDO GONZÁLEZ', 2],
  ['IVAN CALDERÓN', 2], ['RAMÓN GARRIDO', 2], ['ÁLVARO COBOS', 2], ['ALBERTO LOZANO', 1], ['AMIR KUSTAFI', 1], ['ANABLE CHECA', 1], ['CARLOS', 1], ['CHEMI', 1]]
  .map(([name, pts], i) => ({ pos: i + 11, name, pts }));
const T1 = 'C:/Users/jrfmp/Documents/1.RaceUp/Branding RaceUp/Posts IG/';
module.exports = {
  out: __dirname + '/../calibracion',
  slides: [
    { file: 'resultados_r04.png', ref: T1 + 'Race 04/Post 01/Copy of Resultados carreras.png', html: S.resultados({ round: '04', rows, tam: 't1', foto: 'r4_bg', left: 6 }) },
    { file: 'ranking_r04.png', ref: T1 + 'Race 04/Post 02/Copy of Ranking general.png', html: S.rankingTop({ rows: top, foto: 'r4_bg' }) },
    { file: 'lista_r04.png', ref: T1 + 'Race 04/Post 02/Copy of Ranking pilotos.png', html: S.rankingLista({ rows: l1130, desde: 11, hasta: 30, foto: 'r4_bg' }) },
    { file: 'podio_r05.png', ref: 'C:/Users/jrfmp/Downloads/Post 05/Copy of Podium carrera 2.png', html: S.podio({ race: 'RACE 05', circuito: ' KARTING MIJAS', p1: 'FRAN PEÑA', p2: 'ELIEZER DANIELES', p3: 'RAFA LOZANO', foto: 'r5_podio1477', resTitulo: 'RACE 05 RESULTS' }) },
  ],
};
