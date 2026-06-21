import { getCloudinaryImageUrl } from "@/lib/cloudinary";
import type { Photo } from "@/types/photo";

type PhotoGridProps = {
  photos: Photo[];
};

type PhotoTileProps = {
  photo: Photo;
  index: number;
};

const CLOUDINARY_UPLOAD_MARKER = "/image/upload/";

const RESPONSIVE_IMAGE_WIDTHS = [400, 800, 1200, 1600];

function isCloudinaryUrl(url: string): boolean {
  return url.includes(CLOUDINARY_UPLOAD_MARKER);
}

function buildResponsiveSources(url: string): string {
  return RESPONSIVE_IMAGE_WIDTHS.map(
    (width) => `${getCloudinaryImageUrl(url, width)} ${width}w`,
  ).join(", ");
}

function PhotoTile({ photo, index }: PhotoTileProps) {
  const usesCloudinary = isCloudinaryUrl(photo.url);

  const gridImageUrl = usesCloudinary
    ? getCloudinaryImageUrl(photo.url, 400)
    : photo.url;

  const responsiveSources = usesCloudinary
    ? buildResponsiveSources(photo.url)
    : undefined;

  return (
    <article
      className="
        photo-tile
        relative
        mb-[3px]
        break-inside-avoid
        overflow-hidden
        bg-[var(--bg-secondary)]
        md:mb-1
        min-[1201px]:mb-[5px]
      "
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={gridImageUrl}
        srcSet={responsiveSources}
        sizes="
          (max-width: 767px) calc(50vw - 14px),
          (max-width: 1200px) calc(33.333vw - 16px),
          calc(25vw - 20px)
        "
        alt={photo.title}
        width={photo.width}
        height={photo.height}
        loading={index < 6 ? "eager" : "lazy"}
        decoding="async"
        className="photo-image block h-auto w-full"
      />

      <div className="photo-overlay" aria-hidden="true">
        <p className="photo-title">{photo.title}</p>
      </div>
    </article>
  );
}

export default function PhotoGrid({ photos }: PhotoGridProps) {
  return (
    <section
      aria-label="Photography portfolio"
      className="
        columns-2
        px-3
        pb-3
        [column-gap:3px]
        md:columns-3
        md:px-4
        md:pb-4
        md:[column-gap:4px]
        min-[1201px]:columns-4
        min-[1201px]:px-5
        min-[1201px]:pb-5
        min-[1201px]:[column-gap:5px]
      "
    >
      {photos.map((photo, index) => (
        <PhotoTile key={photo.id} photo={photo} index={index} />
      ))}
    </section>
  );
}