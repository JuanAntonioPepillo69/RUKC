// Generadores de slides estilo T1. Cada función devuelve el HTML interior de una slide de 1080x1350.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const fondo = (foto, pos = 'center', luz = 0.2) =>
  `<div class="bg"><img src="fotos/${foto}.jpg" style="object-position:${pos};filter:brightness(${luz}) saturate(.75) contrast(1.05)"></div><div class="grano"></div>`;

// Escudo + "RUKC 2026" con filetes
const cabecera = ({ top = 100, crest = 160, marcaTop = 260, size = 58, filete = 62 } = {}) => `
  <img class="escudo" src="assets/crest-a.png" style="top:${top}px;width:${crest}px">
  <div class="marca" style="top:${marcaTop}px"><span class="f" style="width:${filete}px"></span><span class="t" style="font-size:${size}px">RUKC 2026</span><span class="f d" style="width:${filete}px"></span></div>`;

const pie = (top = 1218) => `<div class="pie" style="top:${top}px">RaceUp Karting Championship</div>`;

// Tamaños: "t1" replica los posts originales; "prod" sube todo a >=26 px (requisito de legibilidad)
const TAM = {
  t1: { nom: 18.5, dor: 19, pos: 20, tie: 17, colL: [105, 420], colR: [557, 423], div: 537, posW: [36, 42], dorW: 50 },
  prod: { nom: 28, dor: 26, pos: 27, tie: 25, colL: [64, 456], colR: [562, 456], div: 540, posW: [50, 54], dorW: 62 },
};

const filaRes = (r, y, t, posW) => `<div class="fila" style="top:${y}px">
  <span class="pos" style="font-size:${t.pos}px;width:${posW}px">${r.pos}</span>
  <span class="dor" style="font-size:${t.dor}px;width:${t.dorW}px">#${esc(String(r.dorsal).padStart(2, '0'))}</span>
  <span class="nom fit" style="font-size:${t.nom}px">${esc(r.name)}</span>
  <span class="tie" style="font-size:${t.tie}px;width:${t.tie * 4.4}px">${esc(r.best)}</span></div>`;

// Resultados de carrera a dos columnas (como "Resultados carreras / ROUND 04")
const resultados = ({ round, rows, foto, fotoPos, luz, tam = 'prod', rowH = 58.6, listTop = 535, left, subtitulo = 'RESULTADOS' }) => {
  const t = TAM[tam];
  const nl = left ?? Math.floor(rows.length / 2);
  const L = rows.slice(0, nl), R = rows.slice(nl);
  const n = Math.max(L.length, R.length);
  return `${fondo(foto, fotoPos, luz)}<div class="capa">${cabecera()}
  <div class="rotulo" style="top:343px;font-size:38px">${subtitulo}</div>
  <div class="titular ext" style="top:392px;font-size:84px">ROUND ${round}</div>
  <div class="col" style="left:${t.colL[0]}px;width:${t.colL[1]}px;top:${listTop}px">${L.map((r, i) => filaRes(r, i * rowH, t, t.posW[0])).join('')}</div>
  <div class="divisor" style="left:${t.div}px;top:${listTop + 5}px;height:${Math.max(560, n * rowH + 30)}px"></div>
  <div class="col" style="left:${t.colR[0]}px;width:${t.colR[1]}px;top:${listTop}px">${R.map((r, i) => filaRes(r, i * rowH, t, t.posW[1])).join('')}</div>
  ${pie()}</div>`;
};

const ptsHtml = p => (p == null ? '<span class="falta">FALTA DATO</span>' : `${p}<small>pts</small>`);

// Ranking con podio P1/P2/P3 destacado y lista 4-10 (como "Ranking general TOP 10")
const rankingTop = ({ rows, titulo = 'RANKING GENERAL', sub = 'TOP 10', foto, fotoPos, luz = 0.22, winner = 'WINNER', tituloSize = 62 }) => {
  const [p1, p2, p3] = rows;
  const rest = rows.slice(3, 10);
  const fila = (r, i) => `<div class="fila fila-r" style="top:${i * 59}px"><span class="pos" style="font-size:26px;width:60px;text-align:right;padding-right:16px">${r.pos}</span><span class="nom fit" style="font-size:29px">${esc(r.name)}</span><span class="pts" style="font-size:31px;width:90px">${ptsHtml(r.pts)}</span></div>`;
  return `${fondo(foto, fotoPos, luz)}<div class="capa">${cabecera({ marcaTop: 266, size: 44, filete: 30 })}
  <div class="titular ext" style="top:336px;font-size:${tituloSize}px;letter-spacing:.04em;text-shadow:none">${titulo}</div>
  <div class="rotulo" style="top:416px;font-size:36px">${sub}</div>
  <div class="podio-r p2" style="left:62px;width:340px;top:518px"><div class="pp ext">P2</div><div class="pn fit1">${esc(p2.name)}</div><div class="ppts">${ptsHtml(p2.pts)}</div></div>
  <div class="podio-r p3" style="left:678px;width:340px;top:518px"><div class="pp ext">P3</div><div class="pn fit1">${esc(p3.name)}</div><div class="ppts">${ptsHtml(p3.pts)}</div></div>
  <div class="podio-r p1" style="left:330px;width:420px;top:500px"><div class="pp ext" style="font-size:90px">P1</div><div class="pw ext">${winner}</div><div class="pn fit1" style="font-size:44px">${esc(p1.name)}</div>
    <div class="ppts p1pts">${ptsHtml(p1.pts)}</div></div>
  <div class="linea-p1"></div>
  <div class="col" style="left:110px;width:830px;top:772px">${rest.map(fila).join('')}</div>
  ${pie()}</div>`;
};

// Ranking a dos columnas (como "Ranking general / POSICIONES 11-30")
const rankingLista = ({ rows, titulo = 'RANKING GENERAL', desde, hasta, foto, fotoPos, luz = 0.2, rowH = 59, porCol = 10, tituloSize = 62 }) => {
  const L = rows.slice(0, porCol), R = rows.slice(porCol);
  const fila = (r, i) => `<div class="fila" style="top:${i * rowH}px"><span class="pos" style="font-size:26px;width:58px">${r.pos}</span><span class="nom fit" style="font-size:28px">${esc(r.name)}</span><span class="pts" style="font-size:30px;width:84px">${ptsHtml(r.pts)}</span></div>`;
  const n = Math.max(L.length, R.length);
  return `${fondo(foto, fotoPos, luz)}<div class="capa">${cabecera()}
  <div class="titular ext" style="top:350px;font-size:${tituloSize}px;letter-spacing:.04em">${titulo}</div>
  <div class="rotulo" style="top:422px;font-size:34px;font-style:italic;letter-spacing:.2em;padding-left:.2em">POSICIONES ${desde}-${hasta}</div>
  <div class="col" style="left:66px;width:456px;top:528px">${L.map(fila).join('')}</div>
  ${R.length ? `<div class="divisor" style="left:539px;top:533px;height:${n * rowH + 6}px"></div>
  <div class="col" style="left:558px;width:456px;top:528px">${R.map(fila).join('')}</div>` : ''}
  ${pie()}</div>`;
};

// Podio de carrera con foto (como "Podium carrera 2")
const podio = ({ race, circuito, p1, p2, p3, foto, fotoPos = 'center', resTitulo, fotoTop = 228, fotoH = 800, extra = '', n1 = 38, n2 = 33 }) => `
  <div class="podio-foto" style="top:${fotoTop}px;height:${fotoH}px"><img src="fotos/${foto}.jpg" style="object-position:${fotoPos}"></div><div class="grano" style="opacity:.35"></div>
  <div class="capa">${cabecera({ top: 62, crest: 138, marcaTop: 198, size: 40, filete: 62 })}
  <div class="rotulo" style="top:239px;font-size:28px;font-weight:400;letter-spacing:.01em;padding:0">${race} - ${circuito}</div>
  <div class="hilo" style="top:290px"></div>${extra}
  <div class="hilo" style="top:1040px;left:75px;right:45px"></div>
  <div class="pod p2" style="left:62px;width:310px"><div class="pn2 fit1" style="font-size:${n2}px">${esc(p2)}</div><div class="pp ext">P2</div></div>
  <div class="vsep" style="left:376px"></div>
  <div class="pod p1" style="left:380px;width:320px;top:1050px"><div class="pw ext">WINNER</div><div class="pn1 fit1" style="font-size:${n1}px">${esc(p1)}</div><div class="pp ext">P1</div></div>
  <div class="vsep" style="left:704px"></div>
  <div class="pod p3" style="left:708px;width:310px"><div class="pn2 fit1" style="font-size:${n2}px">${esc(p3)}</div><div class="pp ext">P3</div></div>
  <div class="hilo" style="top:1162px;left:75px;right:45px"></div>
  <div class="titular ext" style="top:1184px;font-size:42px;letter-spacing:.06em;text-shadow:none">${resTitulo}</div>
  <div class="pie" style="top:1232px;font-size:27px">RaceUp Karting Championship</div></div>`;

// Anuncio / cierre (como "Siguiente carrera")
const anuncio = ({ foto, fotoPos, luz = 0.3, html }) => `${fondo(foto, fotoPos, luz)}<div class="capa">${cabecera()}${html}</div>`;

// Foto a sangre 1080x1350 (las fotos de los carruseles T1 van sin rotular)
const foto = ({ foto, pos = 'center', zoom = 1 }) =>
  `<div class="foto-full"><img src="fotos/${foto}.jpg" style="object-position:${pos};transform:scale(${zoom});transform-origin:${pos}"></div>`;

module.exports = { esc, fondo, cabecera, pie, TAM, resultados, rankingTop, rankingLista, podio, anuncio, foto, ptsHtml };
