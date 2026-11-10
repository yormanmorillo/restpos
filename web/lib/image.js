export async function compressImage(file, { maxDimension = 1600, quality = 0.82 } = {}) {
  if (!file || !file.type.startsWith('image/')) return file;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, '') || 'imagen';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function validateImageFile(file, { maxBytes = 6 * 1024 * 1024 } = {}) {
  if (!file) return 'Selecciona una imagen.';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return 'La imagen debe ser JPG, PNG o WebP.';
  }
  if (file.size > maxBytes) return 'Cada imagen debe pesar menos de 6 MB.';
  return '';
}
