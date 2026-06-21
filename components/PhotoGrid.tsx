"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Photo, TileSize } from "@/types/photo";

type PhotoGridProps = {
  photos: Photo[];
};

type PhotoTileProps = {
  photo: Photo;
};

const GRID_ROW_HEIGHT = 1;

function getColumnSpan(tileSize: TileSize): string {
  if (tileSize === "medium" || tileSize === "large") {
    return "col-span-1 min-[1100px]:col-span-6";
  }

  return "col-span-1 min-[1100px]:col-span-3";
}

function PhotoTile({ photo }: PhotoTileProps) {
  const tileRef = useRef<HTMLElement>(null);
  const [rowSpan, setRowSpan] = useState(1);

  const calculateRowSpan = useCallback(() => {
    const tile = tileRef.current;
    const grid = tile?.parentElement;

    if (!tile || !grid) {
      return;
    }

    const tileWidth = tile.getBoundingClientRect().width;
    const gridStyles = window.getComputedStyle(grid);
    const rowGap = Number.parseFloat(gridStyles.rowGap) || 0;

    const imageHeight = tileWidth * (photo.height / photo.width);

    const nextRowSpan = Math.ceil(
      (imageHeight + rowGap) / (GRID_ROW_HEIGHT + rowGap),
    );

    setRowSpan(Math.max(1, nextRowSpan));
  }, [photo.height, photo.width]);

  useEffect(() => {
    calculateRowSpan();

    const resizeObserver = new ResizeObserver(() => {
      calculateRowSpan();
    });

    const tile = tileRef.current;

    if (tile) {
      resizeObserver.observe(tile);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [calculateRowSpan]);

  return (
    <article
      ref={tileRef}
      className={`
        photo-tile
        relative
        overflow-hidden
        bg-[var(--bg-secondary)]
        ${getColumnSpan(photo.tile_size)}
      `}
      style={{
        gridRowEnd: `span ${rowSpan}`,
      }}
    >
      {/* Temporary Unsplash images for Phase 1. Cloudinary optimisation is added in Phase 2. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={photo.title}
        width={photo.width}
        height={photo.height}
        className="photo-image block h-auto w-full"
        onLoad={calculateRowSpan}
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
        grid
        auto-rows-[1px]
        grid-cols-2
        gap-[3px]
        px-3
        pb-3
        md:grid-cols-4
        md:gap-1
        md:px-4
        md:pb-4
        min-[1100px]:grid-cols-12
        min-[1100px]:gap-[5px]
        min-[1100px]:px-5
        min-[1100px]:pb-5
      "
    >
      {photos.map((photo) => (
        <PhotoTile key={photo.id} photo={photo} />
      ))}
    </section>
  );
}