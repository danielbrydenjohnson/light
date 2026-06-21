import type { Photo } from "@/types/photo";

type PhotoGridProps = {
  photos: Photo[];
};

type PhotoTileProps = {
  photo: Photo;
};

function PhotoTile({ photo }: PhotoTileProps) {
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
      {/* Temporary Unsplash images for Phase 1. Cloudinary optimisation is added in Phase 2. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={photo.title}
        width={photo.width}
        height={photo.height}
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
      {photos.map((photo) => (
        <PhotoTile key={photo.id} photo={photo} />
      ))}
    </section>
  );
}