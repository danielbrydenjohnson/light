"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { getCloudinaryImageUrl } from "@/lib/cloudinary";
import type { Photo } from "@/types/photo";

type PhotoGridProps = {
  photos: Photo[];
};

type PhotoTileProps = {
  photo: Photo;
  index: number;
  position?: PhotoPosition;
};

type PhotoPosition = {
  x: number;
  y: number;
  width: number;
};

type MasonryLayout = {
  height: number;
  positions: PhotoPosition[];
};

type LayoutSettings = {
  columns: number;
  gap: number;
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

function getLayoutSettings(viewportWidth: number): LayoutSettings {
  if (viewportWidth < 768) {
    return {
      columns: 2,
      gap: 3,
    };
  }

  if (viewportWidth <= 1200) {
    return {
      columns: 3,
      gap: 4,
    };
  }

  return {
    columns: 4,
    gap: 5,
  };
}

function calculateMasonryLayout(
  photos: Photo[],
  containerWidth: number,
  viewportWidth: number,
): MasonryLayout {
  const { columns, gap } = getLayoutSettings(viewportWidth);

  const columnWidth =
    (containerWidth - gap * (columns - 1)) / columns;

  const columnHeights = Array.from({ length: columns }, () => 0);

  const positions = photos.map((photo, index) => {
    const rowIndex = Math.floor(index / columns);
    const positionWithinRow = index % columns;

    const columnIndex =
      rowIndex % 2 === 0
        ? positionWithinRow
        : columns - 1 - positionWithinRow;

    const aspectRatio =
      photo.width > 0 && photo.height > 0
        ? photo.width / photo.height
        : 1;

    const renderedHeight = columnWidth / aspectRatio;

    const position: PhotoPosition = {
      x: columnIndex * (columnWidth + gap),
      y: columnHeights[columnIndex],
      width: columnWidth,
    };

    columnHeights[columnIndex] += renderedHeight + gap;

    return position;
  });

  const tallestColumn = Math.max(0, ...columnHeights);

  return {
    positions,
    height: tallestColumn > 0 ? tallestColumn - gap : 0,
  };
}

function PhotoTile({ photo, index, position }: PhotoTileProps) {
  const usesCloudinary = isCloudinaryUrl(photo.url);

  const gridImageUrl = usesCloudinary
    ? getCloudinaryImageUrl(photo.url, 400)
    : photo.url;

  const responsiveSources = usesCloudinary
    ? buildResponsiveSources(photo.url)
    : undefined;

  const positionedStyle: CSSProperties | undefined = position
    ? {
        width: `${position.width}px`,
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      }
    : undefined;

  return (
    <article
      style={positionedStyle}
      className={`
        photo-tile
        overflow-hidden
        bg-[var(--bg-secondary)]
        ${
          position
            ? "absolute left-0 top-0"
            : `
              relative
              mb-[3px]
              break-inside-avoid
              md:mb-1
              min-[1201px]:mb-[5px]
            `
        }
      `}
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
  const containerRef = useRef<HTMLDivElement>(null);
  const previousMeasurementRef = useRef("");

  const [layout, setLayout] = useState<MasonryLayout | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const updateLayout = () => {
      const containerWidth = container.clientWidth;
      const viewportWidth = window.innerWidth;

      if (containerWidth <= 0) {
        return;
      }

      const measurementKey = `${containerWidth}:${viewportWidth}:${photos.length}`;

      if (measurementKey === previousMeasurementRef.current) {
        return;
      }

      previousMeasurementRef.current = measurementKey;

      setLayout(
        calculateMasonryLayout(
          photos,
          containerWidth,
          viewportWidth,
        ),
      );
    };

    previousMeasurementRef.current = "";
    updateLayout();

    const resizeObserver = new ResizeObserver(updateLayout);

    resizeObserver.observe(container);
    window.addEventListener("resize", updateLayout);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateLayout);
    };
  }, [photos]);

  return (
    <section
      aria-label="Photography portfolio"
      className="
        px-3
        pb-3
        md:px-4
        md:pb-4
        min-[1201px]:px-5
        min-[1201px]:pb-5
      "
    >
      <div
        ref={containerRef}
        style={
          layout
            ? {
                height: `${layout.height}px`,
              }
            : undefined
        }
        className={
          layout
            ? "relative"
            : `
              columns-2
              [column-gap:3px]
              md:columns-3
              md:[column-gap:4px]
              min-[1201px]:columns-4
              min-[1201px]:[column-gap:5px]
            `
        }
      >
        {photos.map((photo, index) => (
          <PhotoTile
            key={photo.id}
            photo={photo}
            index={index}
            position={layout?.positions[index]}
          />
        ))}
      </div>
    </section>
  );
}