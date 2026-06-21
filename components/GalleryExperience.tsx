"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import PhotoGrid from "@/components/PhotoGrid";
import {
  calculateEmbeddingSimilarity,
  createTextEmbedding,
  prepareClipTextSearch,
} from "@/lib/clip-search";
import type { Photo } from "@/types/photo";

type GalleryExperienceProps = {
  photos: Photo[];
};

type ModelStatus =
  | "loading"
  | "ready"
  | "error";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_SIMILARITY_THRESHOLD = 0.24;
const EMBEDDING_DIMENSIONS = 512;

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export default function GalleryExperience({
  photos,
}: GalleryExperienceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);

  const [isSearchOpen, setIsSearchOpen] =
    useState(false);

  const [query, setQuery] = useState("");

  const [modelStatus, setModelStatus] =
    useState<ModelStatus>("loading");

  const [isSearching, setIsSearching] =
    useState(false);

  const [searchResults, setSearchResults] =
    useState<Photo[] | null>(null);

  useEffect(() => {
    let isCancelled = false;

    prepareClipTextSearch()
      .then(() => {
        if (!isCancelled) {
          setModelStatus("ready");
        }
      })
      .catch((error) => {
        console.error(
          "Failed to load CLIP text search:",
          error,
        );

        if (!isCancelled) {
          setModelStatus("error");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const retrySearchModel = useCallback(() => {
    setModelStatus("loading");

    prepareClipTextSearch()
      .then(() => {
        setModelStatus("ready");
      })
      .catch((error) => {
        console.error(
          "Failed to load CLIP text search:",
          error,
        );

        setModelStatus("error");
      });
  }, []);

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    if (modelStatus === "error") {
      retrySearchModel();
    }
  }, [
    modelStatus,
    retrySearchModel,
  ]);

  const closeSearch = useCallback(() => {
    searchRequestRef.current += 1;

    setIsSearchOpen(false);
    setQuery("");
    setSearchResults(null);
    setIsSearching(false);
  }, []);

  const toggleSearch = useCallback(() => {
    if (isSearchOpen) {
      closeSearch();
      return;
    }

    openSearch();
  }, [
    closeSearch,
    isSearchOpen,
    openSearch,
  ]);

  function handleQueryChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const nextQuery = event.target.value;

    searchRequestRef.current += 1;

    setQuery(nextQuery);
    setSearchResults(null);
    setIsSearching(false);
  }

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (
      !isSearchOpen ||
      trimmedQuery.length === 0 ||
      modelStatus !== "ready"
    ) {
      return;
    }

    const requestNumber =
      searchRequestRef.current + 1;

    searchRequestRef.current =
      requestNumber;

    const timeout = window.setTimeout(
      async () => {
        setIsSearching(true);

        try {
          const queryEmbedding =
            await createTextEmbedding(
              trimmedQuery,
            );

          if (
            searchRequestRef.current !==
            requestNumber
          ) {
            return;
          }

          const rankedPhotos = photos
            .filter(
              (photo) =>
                photo.embedding.length ===
                EMBEDDING_DIMENSIONS,
            )
            .map((photo) => ({
              photo,
              similarity:
                calculateEmbeddingSimilarity(
                  queryEmbedding,
                  photo.embedding,
                ),
            }))
            .filter(
              ({ similarity }) =>
                similarity >=
                SEARCH_SIMILARITY_THRESHOLD,
            )
            .sort(
              (
                firstResult,
                secondResult,
              ) =>
                secondResult.similarity -
                firstResult.similarity,
            )
            .map(({ photo }) => photo);

          setSearchResults(rankedPhotos);
        } catch (error) {
          console.error(
            "Photo search failed:",
            error,
          );

          if (
            searchRequestRef.current ===
            requestNumber
          ) {
            setSearchResults([]);
          }
        } finally {
          if (
            searchRequestRef.current ===
            requestNumber
          ) {
            setIsSearching(false);
          }
        }
      },
      SEARCH_DEBOUNCE_MS,
    );

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    isSearchOpen,
    modelStatus,
    photos,
    query,
  ]);

  function handleSearchKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "Escape") {
      closeSearch();
    }
  }

  const displayedPhotos =
    searchResults ?? photos;

  const hasNoResults =
    searchResults !== null &&
    searchResults.length === 0 &&
    query.trim().length > 0 &&
    !isSearching;

  const placeholder =
    modelStatus === "loading"
      ? "Loading search..."
      : modelStatus === "error"
        ? "Search unavailable"
        : "Search photos...";

  return (
    <main className="min-h-screen bg-[var(--bg-primary)]">
      <header
        className="
          sticky
          top-0
          z-40
          flex
          h-11
          items-center
          justify-between
          bg-[rgba(10,10,10,0.92)]
          px-3
          backdrop-blur-sm
          md:h-12
          md:px-4
          xl:px-5
        "
      >
        <p className="text-sm font-medium uppercase tracking-[0.05em] text-[var(--text-secondary)]">
          Light
        </p>

        <div className="flex items-center justify-end">
          <div
            className={`
              overflow-hidden
              transition-[width,opacity]
              duration-[250ms]
              ease-out
              ${
                isSearchOpen
                  ? "w-[min(72vw,320px)] opacity-100"
                  : "w-0 opacity-0"
              }
            `}
          >
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={handleQueryChange}
              onKeyDown={handleSearchKeyDown}
              placeholder={placeholder}
              aria-label="Search photographs"
              aria-busy={
                modelStatus === "loading" ||
                isSearching
              }
              disabled={
                modelStatus === "error"
              }
              className={`
                h-9
                w-full
                border-0
                border-b
                border-[var(--border)]
                bg-[var(--search-bg)]
                px-3
                text-base
                text-[var(--text-primary)]
                caret-[var(--accent)]
                outline-none
                transition-colors
                duration-200
                placeholder:text-[var(--text-muted)]
                focus:border-[var(--accent)]
                disabled:cursor-not-allowed
                disabled:opacity-60
                ${
                  modelStatus === "loading" &&
                  query.length === 0
                    ? "animate-pulse"
                    : ""
                }
              `}
            />
          </div>

          <button
            type="button"
            onClick={toggleSearch}
            aria-label={
              isSearchOpen
                ? "Close photo search"
                : "Open photo search"
            }
            aria-expanded={isSearchOpen}
            className="
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              text-[var(--text-secondary)]
              transition-colors
              duration-200
              hover:text-[var(--text-primary)]
              focus-visible:text-[var(--text-primary)]
              focus-visible:outline-none
            "
          >
            <SearchIcon />
          </button>
        </div>
      </header>

      {hasNoResults ? (
        <section
          aria-live="polite"
          className="
            flex
            min-h-[45vh]
            items-center
            justify-center
            px-3
            text-sm
            text-[var(--text-secondary)]
          "
        >
          No matching photos
        </section>
      ) : (
        <PhotoGrid photos={displayedPhotos} />
      )}
    </main>
  );
}