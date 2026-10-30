// Corte de clips para el post de destacados: 4:5 1080x1350, 30 fps, H.264 + AAC.
// - Recorte vertical centrado en `foco_x` (0 = izquierda, 0.5 = centro, 1 = derecha); `zoom` opcional (1.0 a 2.0).
// - Si el vídeo es HDR (HLG o PQ, como los del iPhone) se pasa a SDR bt709 con tonemap.
// - El audio original (motor) se baja de volumen y se funde al principio y al final.
// No toca el vídeo original.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
const VOLUMEN = 0.35;

/** Busca ffmpeg: variable FFMPEG, PATH o la instalación de winget (Gyan.FFmpeg). */
export function buscarFfmpeg() {
  const prueba = (exe) => {
    try { execFileSync(exe, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
  };
  if (process.env.FFMPEG && prueba(process.env.FFMPEG)) return process.env.FFMPEG;
  if (prueba('ffmpeg')) return 'ffmpeg';
  const winget = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(winget)) {
    for (const p of fs.readdirSync(winget).filter((d) => /^Gyan\.FFmpeg/i.test(d))) {
      const base = path.join(winget, p);
      for (const v of fs.readdirSync(base)) {
        const exe = path.join(base, v, 'bin', 'ffmpeg.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const ffprobeDe = (ffmpeg) => (ffmpeg === 'ffmpeg' ? 'ffprobe' : ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m, ext) => `ffprobe${ext ?? ''}`));

export function info(ffmpeg, archivo) {
  const out = execFileSync(ffprobeDe(ffmpeg), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,color_transfer', '-of', 'json', archivo], { encoding: 'utf8' });
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  return {
    duracion: parseFloat(j.format.duration),
    hdr: ['arib-std-b67', 'smpte2084'].includes(v?.color_transfer),
    audio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

/**
 * Corta un clip. `c` = { clip, inicio, duracion, foco_x, zoom }. Usa una caché en `cache/`
 * (mismo origen y mismos parámetros = no se vuelve a codificar) y copia el resultado a `destino`.
 * Devuelve la lista de avisos.
 */
export function cortarClip({ ffmpeg, origen, c, destino, cache }) {
  const avisos = [];
  const inf = info(ffmpeg, origen);
  let inicio = Math.max(0, Number(c.inicio ?? 0));
  let dur = Number(c.duracion ?? 6);
  if (dur < 5 || dur > 10) avisos.push(`${path.basename(origen)}: duración ${dur} s fuera de 5-10 s.`);
  if (inicio + dur > inf.duracion) {
    dur = Math.max(0.5, inf.duracion - inicio);
    if (inicio + Number(c.duracion ?? 6) - inf.duracion > 0.1) avisos.push(`${path.basename(origen)}: el vídeo dura ${inf.duracion.toFixed(1)} s; el clip se queda en ${dur.toFixed(1)} s.`);
  }
  const fx = Math.min(1, Math.max(0, Number(c.foco_x ?? 0.5)));
  const zoom = Math.min(2, Math.max(1, Number(c.zoom ?? 1)));
  const clave = crypto.createHash('sha1').update(JSON.stringify([path.resolve(origen), fs.statSync(origen).size, inicio, dur, fx, zoom, inf.hdr, VOLUMEN])).digest('hex').slice(0, 16);
  fs.mkdirSync(cache, { recursive: true });
  const enCache = path.join(cache, `${clave}.mp4`);
  if (!fs.existsSync(enCache)) {
    // Recorte 4:5 del alto completo (o del ancho, si el vídeo es vertical), reducido por el zoom.
    const w = `min(iw,ih*4/5)/${zoom}`, h = `min(ih,iw*5/4)/${zoom}`;
    const crop = `crop=w='${w}':h='${h}':x='max(0,min(iw-ow,iw*${fx}-ow/2))':y='(ih-oh)/2'`;
    const vf = ['fps=30', ...(inf.hdr ? [TONEMAP] : []), crop, 'scale=1080:1350:flags=lanczos', 'setsar=1', 'format=yuv420p'].join(',');
    const fin = Math.max(0, dur - 0.4).toFixed(2);
    const args = ['-v', 'error', '-y', '-ss', String(inicio), '-t', String(dur), '-i', origen, '-vf', vf,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-r', '30'];
    if (inf.audio) args.push('-af', `volume=${VOLUMEN},afade=t=in:d=0.3,afade=t=out:st=${fin}:d=0.4`, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
    else args.push('-an');
    args.push('-movflags', '+faststart', enCache + '.tmp.mp4');
    execFileSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    fs.renameSync(enCache + '.tmp.mp4', enCache);
  }
  fs.copyFileSync(enCache, destino);
  return avisos;
}

/** Extrae un fotograma (JPG) de un clip ya cortado, en el segundo `t`. */
export function fotograma(ffmpeg, clip, t, jpg) {
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(t), '-i', clip, '-frames:v', '1', '-q:v', '3', jpg], { stdio: ['ignore', 'ignore', 'inherit'] });
}
