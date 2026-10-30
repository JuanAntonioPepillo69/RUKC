// Foto a sangre 1080x1350, sin texto (post de destacados). Se exporta como JPG.
import { documento, foto } from './comun.mjs';

export default function fotoCompleta(ctx, { foto: f }) {
  return documento(ctx, foto(ctx, f), 'a-sangre');
}
