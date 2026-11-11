// Interruptor general del bot (bot_settings.bot_activo).
// Uso:  npm run bot:interruptor            muestra el estado
//       npm run bot:interruptor -- off     lo apaga (igual que "PARA TODO" desde el canal admin, sin vaciar la cola)
//       npm run bot:interruptor -- on      lo enciende (en la fase 2 se hará con "REANUDA" y código)
// Lee DATABASE_URL de .env (desarrollo). Para producción: node --env-file=.env.produccion db/bot-interruptor.mjs on
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}
const q = neon(process.env.DATABASE_URL);
const orden = (process.argv[2] || '').toLowerCase();
if (orden && !['on', 'off'].includes(orden)) {
  console.error('Uso: on | off');
  process.exit(1);
}
if (orden) await q.query(`UPDATE bot_settings SET valor = $1 WHERE clave = 'bot_activo'`, [orden === 'on' ? 'true' : 'false']);
const [f] = await q.query(`SELECT valor, updated_at FROM bot_settings WHERE clave = 'bot_activo'`);
console.log(`Bot ${f?.valor === 'false' ? 'APAGADO' : 'encendido'} (último cambio: ${f?.updated_at?.toISOString?.() ?? f?.updated_at}).`);
