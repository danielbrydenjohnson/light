"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import { getCloudinaryImageUrl } from "@/lib/cloudinary";
import type { Photo } from "@/types/photo";

type LightboxProps = {
  photos: Photo[];
  selectedPhoto: Photo;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSelectPhoto: (photo: Photo) => void;
};

const CLOUDINARY_UPLOAD_MARKER = "/image/upload/";
const SIMILAR_PHOTO_COUNT = 5;
const IMAGE_TRANSITION_DURATION = 300;

function isCloudinaryUrl(url: string): boolean {
  return url.includes(CLOUDINARY_UPLOAD_MARKER);
}

function getLightboxImageUrl(photo: Photo): string {
  return isCloudinaryUrl(photo.url)
    ? getCloudinaryImageUrl(photo.url, 1200)
    : photo.url;
}

function getThumbnailImageUrl(photo: Photo): string {
  return isCloudinaryUrl(photo.url)
    ? getCloudinaryImageUrl(photo.url, 240)
    : photo.url;
}

function cosineSimilarity(
  firstEmbedding: number[],
  secondEmbedding: number[],
): number {
  if (
    firstEmbedding.length === 0 ||
    firstEmbedding.length !== secondEmbedding.length
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  let dotProduct = 0;
  let firstMagnitude = 0;
  let secondMagnitude = 0;

  for (
    let index = 0;
    index < firstEmbedding.length;
    index += 1
  ) {
    const firstValue = firstEmbedding[index];
    const secondValue = secondEmbedding[index];

    dotProduct += firstValue * secondValue;
    firstMagnitude += firstValue * firstValue;
    secondMagnitude += secondValue * secondValue;
  }

  const denominator =
    Math.sqrt(firstMagnitude) *
    Math.sqrt(secondMagnitude);

  if (denominator === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return dotProduct / denominator;
}

function getPhotoHeading(photo: Photo): string | null {
  const trimmedTitle = photo.title.trim();

  if (
    trimmedTitle.length === 0 ||
    trimmedTitle === photo.filename
  ) {
    return photo.location;
  }

  if (photo.location) {
    return `${trimmedTitle} · ${photo.location}`;
  }

  return trimmedTitle;
}

function getExifValues(photo: Photo): string[] {
  return [
    photo.exif_camera,
    photo.exif_lens,
    photo.exif_focal_length,
    photo.exif_shutter_speed,
    photo.exif_aperture,
    photo.exif_iso,
  ].filter(
    (value): value is string =>
      typeof value === "string" &&
      value.trim().length > 0,
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function PreviousIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function Lightbox({
  photos,
  selectedPhoto,
  onClose,
  onNext,
  onPrevious,
  onSelectPhoto,
}: LightboxProps) {
  const [displayedPhoto, setDisplayedPhoto] =
    useState(selectedPhoto);

  const [outgoingPhoto, setOutgoingPhoto] =
    useState<Photo | null>(null);

  const [isIncomingVisible, setIsIncomingVisible] =
    useState(true);

  const displayedPhotoRef = useRef(selectedPhoto);
  const transitionTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const animationFrameRef = useRef<number | null>(null);

  const similarPhotos = useMemo(() => {
    if (displayedPhoto.embedding.length === 0) {
      return [];
    }

    return photos
      .filter((photo) => photo.id !== displayedPhoto.id)
      .map((photo) => ({
        photo,
        similarity: cosineSimilarity(
          displayedPhoto.embedding,
          photo.embedding,
        ),
      }))
      .filter((result) =>
        Number.isFinite(result.similarity),
      )
      .sort(
        (firstResult, secondResult) =>
          secondResult.similarity -
          firstResult.similarity,
      )
      .slice(0, SIMILAR_PHOTO_COUNT)
      .map((result) => result.photo);
  }, [displayedPhoto, photos]);

  const heading = getPhotoHeading(displayedPhoto);
  const exifValues = getExifValues(displayedPhoto);

  useEffect(() => {
    if (
      selectedPhoto.id ===
      displayedPhotoRef.current.id
    ) {
      return;
    }

    let cancelled = false;

    const targetPhoto = selectedPhoto;
    const imagePreloader = new Image();

    function completeImageSwap() {
      if (cancelled) {
        return;
      }

      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      setOutgoingPhoto(displayedPhotoRef.current);
      setIsIncomingVisible(false);

      displayedPhotoRef.current = targetPhoto;
      setDisplayedPhoto(targetPhoto);

      animationFrameRef.current =
        requestAnimationFrame(() => {
          setIsIncomingVisible(true);
        });

      transitionTimeoutRef.current = setTimeout(() => {
        setOutgoingPhoto(null);
        transitionTimeoutRef.current = null;
      }, IMAGE_TRANSITION_DURATION);
    }

    imagePreloader.onload = completeImageSwap;
    imagePreloader.onerror = completeImageSwap;
    imagePreloader.src = getLightboxImageUrl(targetPhoto);

    return () => {
      cancelled = true;
      imagePreloader.onload = null;
      imagePreloader.onerror = null;
    };
  }, [selectedPhoto]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowLeft") {
        onPrevious();
        return;
      }

      if (event.key === "ArrowRight") {
        onNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;

      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );

      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [onClose, onNext, onPrevious]);

  function handleBackdropClick(
    event: MouseEvent<HTMLDivElement>,
  ) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onClick={handleBackdropClick}
      className="
        group
        fixed
        inset-0
        z-50
        overflow-y-auto
        bg-black/95
      "
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo viewer"
        className="
          fixed
          right-4
          top-4
          z-[60]
          flex
          h-10
          w-10
          items-center
          justify-center
          text-[var(--text-secondary)]
          transition-colors
          duration-200
          hover:text-[var(--text-primary)]
          focus-visible:text-[var(--text-primary)]
          focus-visible:outline-none
          md:right-6
          md:top-5
        "
      >
        <CloseIcon />
      </button>

      <button
        type="button"
        onClick={onPrevious}
        aria-label="Previous photograph"
        className="
          fixed
          left-2
          top-1/2
          z-[60]
          hidden
          h-12
          w-12
          -translate-y-1/2
          items-center
          justify-center
          text-[var(--text-secondary)]
          opacity-0
          transition-all
          duration-200
          hover:text-[var(--text-primary)]
          focus-visible:opacity-100
          focus-visible:outline-none
          group-hover:opacity-100
          md:flex
        "
      >
        <PreviousIcon />
      </button>

      <button
        type="button"
        onClick={onNext}
        aria-label="Next photograph"
        className="
          fixed
          right-2
          top-1/2
          z-[60]
          hidden
          h-12
          w-12
          -translate-y-1/2
          items-center
          justify-center
          text-[var(--text-secondary)]
          opacity-0
          transition-all
          duration-200
          hover:text-[var(--text-primary)]
          focus-visible:opacity-100
          focus-visible:outline-none
          group-hover:opacity-100
          md:flex
        "
      >
        <NextIcon />
      </button>

      <div
        className="
          mx-auto
          flex
          min-h-full
          w-full
          max-w-[1400px]
          flex-col
          justify-center
          py-14
          md:px-16
          md:py-12
        "
      >
        <div
          className="
            grid
            w-full
            place-items-center
          "
        >
          {outgoingPhoto ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={getLightboxImageUrl(outgoingPhoto)}
              alt=""
              width={outgoingPhoto.width}
              height={outgoingPhoto.height}
              aria-hidden="true"
              className={`
                pointer-events-none
                col-start-1
                row-start-1
                block
                max-h-[78vh]
                w-auto
                max-w-full
                object-contain
                transition-opacity
                duration-300
                ease-in-out
                md:max-w-[90vw]
                ${
                  isIncomingVisible
                    ? "opacity-0"
                    : "opacity-100"
                }
              `}
            />
          ) : null}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={displayedPhoto.id}
            src={getLightboxImageUrl(displayedPhoto)}
            alt={displayedPhoto.title}
            width={displayedPhoto.width}
            height={displayedPhoto.height}
            className={`
              col-start-1
              row-start-1
              block
              max-h-[78vh]
              w-auto
              max-w-full
              object-contain
              transition-opacity
              duration-300
              ease-in-out
              md:max-w-[90vw]
              ${
                isIncomingVisible
                  ? "opacity-100"
                  : "opacity-0"
              }
            `}
          />
        </div>

        <div
          className="
            mx-auto
            w-full
            max-w-[1200px]
            px-4
            pt-4
            md:px-0
          "
        >
          {heading ? (
            <p className="text-sm text-[var(--text-primary)]">
              {heading}
            </p>
          ) : null}

          {exifValues.length > 0 ? (
            <p
              className={`
                text-[11px]
                leading-5
                text-[var(--text-muted)]
                ${heading ? "mt-1" : ""}
              `}
            >
              {exifValues.join(" · ")}
            </p>
          ) : null}

          {similarPhotos.length > 0 ? (
            <section
              aria-label="Similar photographs"
              className="mt-7"
            >
              <p
                className="
                  text-[11px]
                  font-medium
                  uppercase
                  tracking-[0.1em]
                  text-[var(--text-secondary)]
                "
              >
                Similar
              </p>

              <div
                className="
                  mt-3
                  flex
                  gap-2
                  overflow-x-auto
                  pb-2
                "
              >
                {similarPhotos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() =>
                      onSelectPhoto(photo)
                    }
                    aria-label={`View ${photo.title}`}
                    className="
                      shrink-0
                      overflow-hidden
                      bg-[var(--bg-secondary)]
                      focus-visible:outline
                      focus-visible:outline-1
                      focus-visible:outline-offset-2
                      focus-visible:outline-[var(--text-secondary)]
                    "
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getThumbnailImageUrl(photo)}
                      alt={photo.title}
                      width={photo.width}
                      height={photo.height}
                      loading="lazy"
                      decoding="async"
                      className="
                        h-20
                        w-auto
                        max-w-[150px]
                        object-cover
                        transition-opacity
                        duration-200
                        hover:opacity-80
                      "
                    />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}