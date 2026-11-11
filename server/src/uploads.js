import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validationError } from './errors.js';

const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const ALLOWED_IMAGE_TYPES = Object.keys(IMAGE_EXTENSIONS);

export function ensureUploadDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export function saveImageFile(file, uploadsPath, subdir) {
  if (!file) throw validationError('No se recibió ninguna imagen.');
  const extension = IMAGE_EXTENSIONS[file.mimetype];
  if (!extension) throw validationError('Formato de imagen no permitido.');
  if (detectImageMime(file.buffer) !== file.mimetype) {
    throw validationError('El contenido del archivo no corresponde a una imagen JPG, PNG o WebP.');
  }
  const dir = ensureUploadDir(path.join(uploadsPath, subdir));
  const filename = `${randomUUID()}${extension}`;
  const target = path.join(dir, filename);
  writeFileSync(target, file.buffer);
  return filename;
}

export function imageFilePath(uploadsPath, subdir, filename) {
  if (!filename || path.basename(filename) !== filename || !/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) {
    return null;
  }
  return path.join(uploadsPath, subdir, filename);
}

export function removeImageFile(uploadsPath, subdir, filename) {
  const target = imageFilePath(uploadsPath, subdir, filename);
  if (!target) return;
  try {
    unlinkSync(target);
  } catch {
    // La imagen pudo haberse borrado ya; no bloquea la operación.
  }
}
