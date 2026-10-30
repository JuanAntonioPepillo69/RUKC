// Ranking acumulado T1 a partir de Resultados_Pilotos.xlsx.
// Escala de la hoja: 25-18-15-12-10-8-6-4-2-1 y 1 punto al resto (columna "Puntos sumados").
// Desempate: se mantiene el orden del ranking anterior; los pilotos nuevos entran detrás, en orden de carrera.
const ExcelJS = require('C:/Users/jrfmp/Web/node_modules/exceljs');
const fs = require('fs');
const path = require('path');

const XLSX = 'C:/Users/jrfmp/Downloads/Resultados_Pilotos.xlsx';
const val = v => (v && v.result !== undefined ? v.result : v && v.text ? v.text : v);

// Nombre canónico (tal y como sale en el ranking publicado tras la R4) para cada nombre de las hojas.
const ALIAS = {
  'Elieze': 'ELIEZER DANIELES', 'Aaron': 'ARON PETERZENS', 'Adrián': 'ADRIÁN MORENO', 'Manuél Mañeros': 'MANUEL MAÑERO',
  'Manuel Mañeros': 'MANUEL MAÑERO', 'Rafa Lozano': 'RAFAEL LOZANO', 'Cristobal': 'CRISTÓBAL CORRAL', 'Cristobal Corral': 'CRISTÓBAL CORRAL',
  'Cristóbal ': 'CRISTÓBAL N.P.', 'José Plaja': 'JOSÉ PLAJA', 'Jose Luis Plaja': 'JOSÉ PLAJA', 'Javier Cabello': 'JAVIER CABELLO',
  'Álvaro Cobos ': 'ÁLVARO COBOS', 'Julio Benítez': 'JULIO BENITEZ', 'Daniel Dominguez': 'DANIEL DOMÍNGUEZ', 'RAFAEL FORTES': 'RAFAEL FORTES',
  'Raúl Gonzalez': 'RAÚL GONZALEZ', 'Ivan Calderón': 'IVAN CALDERÓN', 'Oscar García': 'OSCAR GARCÍA', 'José Delgado': 'JOSÉ DELGADO',
  'Niko': 'MYKOLA SKRYPNIK', 'Diego Ronzi': 'DIEGO RONZI', 'Álvaro Gomez': 'ÁLVARO GOMEZ',
  // Race 06 (nombres en mayúsculas y cortados por el cronometraje)
  'GONZALO VERGARA': 'GONZALO VERGARA', 'DANIEL AGROMARTIN': 'DANIEL AGROMARTIN', 'JUAN AMADOR': 'JUAN AMADOR',
  'ALAIN ESKURZA SILVES': 'ALAIN ESKURZA', 'MYKOLA SKRYPNIK': 'MYKOLA SKRYPNIK', 'RAFAEL LOZANO': 'RAFAEL LOZANO',
  'ÓSCAR GARCÍA PEÑA': 'OSCAR GARCÍA', 'VADYM': 'VADYM', 'RODRIGO MÉNDEZ': 'RODRIGO MÉNDEZ', 'FRAN PEÑA': 'FRAN PEÑA',
  'VICTOR ROMERO': 'VICTOR ROMERO', 'ELIEZER DANIELES': 'ELIEZER DANIELES', 'ÁLVARO GÓMEZ': 'ÁLVARO GOMEZ',
  'PABLO BESCANSA': 'PABLO BESCANSA', 'LUCAS PINTO': 'LUCAS PINTO', 'JULIO BENITEZ MORENO': 'JULIO BENITEZ',
  'JAVIER AGÜERA DEL RÍO': 'JAVIER AGÜERA', 'MARIO PACHECHO': 'MARIO PACHECO', 'SAMUEL CÉSAR SILVES': 'SAMUEL CESAR',
  'CRISTÓBAL LÓPEZ CORI': 'CRISTÓBAL CORRAL', 'GEORGI': 'GEORGI', 'DAVID PACHECHO LÓPEZ': 'DAVID PACHECO',
  'ARON PETERZENS': 'ARON PETERZENS', 'JERÓNIMO FERNÁNDEZ': 'JERÓNIMO FERNÁNDEZ', 'ALFREDO REYES': 'ALFREDO REYES',
  'FRACISCO PINTO': 'FRANCISCO PINTO', 'ADAM': 'ADAM', 'ALEJANDRO CALLE PINT': 'ALEJANDRO CALLE', 'JOSÉ PLAJA': 'JOSÉ PLAJA',
};
// Nombre que se imprime en resultados de carrera (forma corta, corrige erratas del cronometraje)
const RESULT_NAME = {
  'JULIO BENITEZ': 'JULIO BENÍTEZ', 'ÁLVARO GOMEZ': 'ÁLVARO GÓMEZ', 'OSCAR GARCÍA': 'ÓSCAR GARCÍA', 'SAMUEL CESAR': 'SAMUEL CÉSAR',
};

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const ws = wb.getWorksheet('Ranking general');

  // 1) Ranking publicado tras la R4 (tabla "Ranking/Piloto/Total", filas 36-74), con nombres del post T1
  const t1 = [];
  for (let r = 36; r <= 74; r++) {
    const row = ws.getRow(r).values.map(val);
    t1.push({ pos: row[1], sheetName: row[2], pts: row[4] });
  }
  const PUBLISHED = ['RAFAEL LOZANO', 'ELIEZER DANIELES', 'FRAN PEÑA', 'MANUEL MAÑERO', 'GONZALO VERGARA', 'PABLO RÍOS', 'JULIO BENITEZ',
    'ADRIÁN MORENO', 'LUCAS PINTO', 'ARON PETERZENS', 'RAÚL GONZALEZ', 'DANIEL DOMÍNGUEZ', 'ALFREDO REYES', 'RAFAEL FORTES', 'JOHN FORTES',
    'JOSE MIGUEL', 'JULIO BAUTISTA', 'SAMUEL CESAR', 'CRISTÓBAL CORRAL', 'ÁLVARO GOMEZ', 'JOSE MARÍA', 'FERNANDO GONZÁLEZ', 'IVAN CALDERÓN',
    'RAMÓN GARRIDO', 'ÁLVARO COBOS', 'ALBERTO LOZANO', 'AMIR KUSTAFI', 'ANABLE CHECA', 'CARLOS', 'CHEMI', 'CRISTÓBAL N.P.', 'DANIEL ALDANA',
    'DAVID', 'FRANCISCO PINTO', 'IDELFONSO FERNÁNDEZ', 'JAVIER CABELLO', 'JOSÉ PLAJA', 'MARKEL V', 'SARA'];
  const PUBLISHED_PTS = [70, 50, 42, 35, 26, 25, 24, 19, 18, 16, 16, 11, 9, 9, 8, 8, 6, 6, 5, 5, 4, 2, 2, 2, 2, ...Array(14).fill(1)];
  let standings = PUBLISHED.map((name, i) => ({ name, pts: t1[i].pts }));
  const ok = standings.every((s, i) => s.pts === PUBLISHED_PTS[i]) && standings.length === 39;
  console.log('Comprobación ranking R4 publicado vs hoja:', ok ? 'OK (39 pilotos, P1 70 pts)' : 'NO CUADRA');
  if (!ok) process.exit(1);

  // 1b) Comprobación de la escala: R1-R4 recalculados con la columna "Puntos sumados" de cada carrera
  const races = {
    R1: { sheet: 'T1 - Carrera 1 - Kart&Fun Málag', name: 1, dorsal: 2, best: 3, pts: 5 },
    R2: { sheet: 'T1 - Carrera 2 - Karting Mijas', name: 1, dorsal: 2, best: 4, pts: 6 },
    R3: { sheet: 'T1 - Carrera 3 - Karting del So', name: 1, dorsal: 2, best: 3, pts: 5 },
    R4: { sheet: 'T1 - Carrera 4 - Kart&Fun Estep', name: 1, dorsal: 3, best: 4, pts: 6 },
    R5: { sheet: 'Copy of T1 - Carrera 2 - Kartin', name: 1, dorsal: 2, best: 3, pts: 5 },
    R6: { sheet: 'T1 - Carrera 6 - Campillos', name: 1, dorsal: 2, best: 3, pts: 5 },
  };
  const canon = n => ALIAS[n] || n.trim().toUpperCase().replace('Í', 'Í');
  const readRace = key => {
    const c = races[key];
    const s = wb.worksheets.find(w => w.name.startsWith(c.sheet));
    const out = [];
    s.eachRow((r, i) => {
      if (i === 1) return;
      const v = r.values.slice(1).map(val);
      if (typeof v[0] !== 'number' || !v[c.name]) return;
      out.push({ pos: v[0], sheetName: v[c.name], name: canon(v[c.name]), dorsal: String(v[c.dorsal]).replace(/\D.*$/, '') || String(v[c.dorsal]), best: String(v[c.best]).trim(), pts: v[c.pts] });
    });
    return out;
  };
  const scale = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  for (const k of Object.keys(races)) {
    const rr = readRace(k);
    const bad = rr.filter(r => r.pts !== (scale[r.pos - 1] || 1));
    console.log(k, rr.length, 'pilotos; escala', bad.length ? 'DISTINTA en ' + bad.map(b => b.pos).join(',') : 'OK');
  }
  const r4tot = {};
  for (const k of ['R1', 'R2', 'R3', 'R4']) for (const r of readRace(k)) r4tot[r.name] = (r4tot[r.name] || 0) + r.pts;
  const diff = standings.filter(s => (r4tot[s.name] || 0) !== s.pts).map(s => `${s.name} hoja=${r4tot[s.name] || 0} publicado=${s.pts}`);
  console.log('R1-R4 sumados con alias vs publicado:', diff.length ? diff.join(' | ') : 'OK, coinciden los 39');

  const apply = (prev, race) => {
    const map = new Map(prev.map((s, i) => [s.name, { ...s, prevIdx: i }]));
    let n = prev.length;
    for (const r of race) {
      if (!map.has(r.name)) map.set(r.name, { name: r.name, pts: 0, prevIdx: n++ });
      map.get(r.name).pts += r.pts;
    }
    return [...map.values()].sort((a, b) => b.pts - a.pts || a.prevIdx - b.prevIdx).map(({ name, pts }) => ({ name, pts }));
  };
  const r5 = readRace('R5'), r6 = readRace('R6');
  const afterR5 = apply(standings, r5);
  const afterR6 = apply(afterR5, r6);

  // Comprobación cruzada: hoja "Fotos" (lista de diplomas) sigue el orden del ranking tras la R5
  const fotos = wb.getWorksheet('Fotos');
  const fotosOrder = [];
  fotos.eachRow((r, i) => { if (i > 2) fotosOrder.push(r.values.map(val)[3]); });
  const cmp = afterR5.slice(1).map((s, i) => [s.name, fotosOrder[i]]);
  console.log('Orden hoja Fotos vs ranking tras R5 (pos 2-45):');
  console.log(cmp.map(([a, b], i) => `${i + 2} ${a} | ${b}`).join('\n'));

  const resultRows = race => race.map(r => ({ pos: r.pos, dorsal: r.dorsal, name: RESULT_NAME[r.name] || r.name, best: r.best, pts: r.pts }));
  const out = { afterR5, afterR6, r5: resultRows(r5), r6: resultRows(r6) };
  fs.writeFileSync(path.join(__dirname, 'datos.json'), JSON.stringify(out, null, 1));
  console.log('\nTras R5:', afterR5.length, 'pilotos. Top 5', afterR5.slice(0, 5));
  console.log('Final:', afterR6.length, 'pilotos');
  console.log(afterR6.map((s, i) => `${i + 1} ${s.name} ${s.pts}`).join('\n'));
})();
