// Race 06 Campillos, la FINAL de la T1: portada de campeón, podio, resultados, clasificación final, fotos y cierre
const S = require('../slides.cjs');
const D = require('../datos.json');
const rk = D.afterR6.map((s, i) => ({ pos: i + 1, ...s }));
// en resultados el hueco del nombre es menor: abrevio el único que no cabe a 28 px
const res = D.r6.map(r => (r.name === 'JERÓNIMO FERNÁNDEZ' ? { ...r, name: 'JERÓNIMO FDEZ.' } : r));
const [c1, c2, c3] = rk;

const portada = `${S.foto({ foto: 'r6_campeon' })}
  <div class="velo-lado"></div><div class="velo-portada"></div><div class="grano" style="opacity:.4"></div>
  <div class="capa">
    <img class="escudo" src="assets/crest-a.png" style="top:48px;width:128px">
    <div class="marca" style="top:902px"><span class="f" style="width:62px"></span><span class="t" style="font-size:50px">RUKC 2026</span><span class="f d" style="width:62px"></span></div>
    <div class="titular ext" style="top:972px;font-size:118px;letter-spacing:.02em">CAMPEÓN</div>
    <div class="titular" style="top:1108px;font-family:Archivo;font-weight:800;font-size:56px;color:#ffc42a;text-shadow:0 0 18px rgba(255,180,30,.45)">${c1.name}</div>
    <div class="esp" style="top:1184px;font-size:30px;color:#f1f1f1">TEMPORADA 1 <span class="oro">&middot;</span> ${c1.pts} PTS</div>
    ${S.pie(1248).replace('font-size', '')}
  </div>`;

const cierre = S.anuncio({ foto: 'r6_5546', fotoPos: '50% 60%', luz: 0.3, html: `
  <div class="esp oro" style="top:462px;font-size:34px">${rk.length} PILOTOS <span style="color:#fff">&middot;</span> 6 CARRERAS</div>
  <div class="titular ext" style="top:530px;font-size:124px">GRACIAS</div>
  <div class="esp" style="top:684px;font-size:36px;color:#fff">POR LA TEMPORADA 1</div>
  <div class="esp" style="top:888px;font-size:34px;color:#fff">TEMPORADA 2</div>
  <div class="hilo" style="top:940px;left:250px;right:250px"></div>
  <div class="esp oro" style="top:956px;font-size:34px;letter-spacing:.24em;padding-left:.24em">17.10.2026 &middot; KARTING MIJAS</div>
  <div class="destello" style="top:1050px"></div>
  <div class="esp" style="top:1150px;font-size:31px;font-weight:700;letter-spacing:.2em;padding-left:.2em;color:#fff">INSCRIPCIÓN EN RACEUPKC.COM</div>
  <div class="hilo" style="top:1200px;left:150px;right:150px;opacity:.6"></div>
  ${S.pie(1222)}` });

module.exports = {
  out: 'C:/Users/jrfmp/Documents/1.RaceUp/Branding RaceUp/Posts IG/Race 06',
  slides: [
    { file: '01_campeon_temporada.png', html: portada },
    { file: '02_podio_final.png', html: S.podio({ race: 'RACE 06', circuito: 'CAMPILLOS &middot; LA FINAL', p1: res[0].name, p2: res[1].name, p3: res[2].name, foto: 'r6_5889', fotoPos: '50% 55%', resTitulo: 'RACE 06 RESULTS', n1: 34, n2: 30 }) },
    { file: '03_resultados_round06_4-16.png', html: S.resultados({ round: '06', rows: res.slice(3, 16), left: 6, foto: 'r6_5714', luz: 0.22 }) },
    { file: '04_resultados_round06_17-29.png', html: S.resultados({ round: '06', rows: res.slice(16), left: 6, foto: 'r6_5549', luz: 0.22 }) },
    { file: '05_clasificacion_final_top10.png', html: S.rankingTop({ rows: rk, titulo: 'RANKING FINAL', sub: 'TEMPORADA 1', winner: 'CAMPEÓN', foto: 'r6_5864', fotoPos: '50% 60%' }) },
    { file: '06_clasificacion_final_11-30.png', html: S.rankingLista({ rows: rk.slice(10, 30), titulo: 'RANKING FINAL', desde: 11, hasta: 30, foto: 'r6_5546' }) },
    { file: '07_clasificacion_final_31-50.png', html: S.rankingLista({ rows: rk.slice(30, 50), titulo: 'RANKING FINAL', desde: 31, hasta: 50, foto: 'r6_5714', fotoPos: '50% 70%' }) },
    { file: '08_clasificacion_final_51-57.png', html: S.rankingLista({ rows: rk.slice(50), titulo: 'RANKING FINAL', desde: 51, hasta: rk.length, foto: 'r6_5549' }) },
    { file: '09_foto.png', html: S.foto({ foto: 'r6_5917', pos: '40% 50%' }) },
    { file: '10_foto.png', html: S.foto({ foto: 'r6_5549', pos: '55% 50%' }) },
    { file: '11_foto.png', html: S.foto({ foto: 'r6_5864', pos: '45% 50%' }) },
    { file: '12_foto.png', html: S.foto({ foto: 'r6_5834', pos: '30% 50%' }) },
    { file: '13_foto.png', html: S.foto({ foto: 'r6_5448', pos: '45% 50%' }) },
    { file: '14_foto.png', html: S.foto({ foto: 'r6_5799', pos: '45% 50%' }) },
    { file: '15_cierre_temporada.png', html: cierre },
  ],
};
