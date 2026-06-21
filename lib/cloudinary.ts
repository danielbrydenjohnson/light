const CLOUDINARY_UPLOAD_MARKER = "/image/upload/";

export function getCloudinaryImageUrl(
  originalUrl: string,
  width: number,
): string {
  if (!originalUrl.includes(CLOUDINARY_UPLOAD_MARKER)) {
    throw new Error(`Invalid Cloudinary image URL: ${originalUrl}`);
  }

  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`Cloudinary image width must be positive: ${width}`);
  }

  const transformation = `w_${Math.round(width)},q_auto,f_auto`;

  return originalUrl.replace(
    CLOUDINARY_UPLOAD_MARKER,
    `${CLOUDINARY_UPLOAD_MARKER}${transformation}/`,
  );
}