// Race 05 Karting Mijas (T1): reutiliza podio, resultados y siguiente carrera ya hechos; añade ranking tras R5 y fotos
const S = require('../slides.cjs');
const D = require('../datos.json');
const P5 = 'C:/Users/jrfmp/Downloads/Post 05/';
// en la R5 Mykola Skrypnik corrió y salió publicado como "NIKO" (mismo dorsal 26)
const rk = D.afterR5.map((s, i) => ({ pos: i + 1, ...s, name: s.name === 'MYKOLA SKRYPNIK' ? 'NIKO' : s.name }));
module.exports = {
  out: 'C:/Users/jrfmp/Documents/1.RaceUp/Branding RaceUp/Posts IG/Race 05',
  slides: [
    { file: '01_podio.png', copy: P5 + 'Copy of Podium carrera 2.png' },
    { file: '02_resultados_round05.png', copy: P5 + 'Copy of Resultados carreras.png' },
    { file: '03_ranking_general_top10.png', html: S.rankingTop({ rows: rk, foto: 'r5_5272', fotoPos: '50% 60%' }) },
    { file: '04_ranking_general_11-30.png', html: S.rankingLista({ rows: rk.slice(10, 30), desde: 11, hasta: 30, foto: 'r5_5181' }) },
    { file: '05_ranking_general_31-45.png', html: S.rankingLista({ rows: rk.slice(30), desde: 31, hasta: rk.length, porCol: 8, foto: 'r5_5053', fotoPos: '30% 50%' }) },
    { file: '06_siguiente_carrera.png', copy: P5 + 'Copy of Siguiente carrera.png' },
    { file: '07_foto.png', html: S.foto({ foto: 'r5_5084', pos: '38% 50%' }) },
    { file: '08_foto.png', html: S.foto({ foto: 'r5_5241', pos: '58% 50%' }) },
    { file: '09_foto.png', html: S.foto({ foto: 'r5_5053', pos: '42% 50%' }) },
  ],
};
