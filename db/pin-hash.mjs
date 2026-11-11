// Genera el valor de ADMIN_PIN_HASH a partir de tu PIN de 6 cifras. El PIN no se guarda en ningún sitio ni se
// enseña: se escribe dos veces y solo sale el hash, que se pega en Vercel (Production y Preview).
// Uso: node db/pin-hash.mjs
import readline from 'node:readline';
import { hashPin } from '../lib/bot/pin.js';

function preguntarOculto(texto) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(texto)) rl.output.write(s); };
    rl.question(texto, (v) => { rl.close(); process.stdout.write('\n'); ok(v.trim()); });
  });
}

const a = await preguntarOculto('PIN de 6 cifras: ');
const b = await preguntarOculto('Repite el PIN: ');
if (a !== b) { console.error('No coinciden.'); process.exit(1); }
if (!/^\d{6}$/.test(a)) { console.error('Tienen que ser 6 cifras.'); process.exit(1); }
console.log(`\nADMIN_PIN_HASH=${hashPin(a)}`);
