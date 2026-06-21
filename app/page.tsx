import PhotoGrid from "@/components/PhotoGrid";
import dummyPhotos from "@/data/dummy-photos.json";
import type { Photo } from "@/types/photo";

export default function Home() {
  const photos = [...(dummyPhotos as Photo[])].sort(
    (firstPhoto, secondPhoto) =>
      firstPhoto.dominant_hue - secondPhoto.dominant_hue,
  );

  return (
    <main className="min-h-screen bg-[var(--bg-primary)]">
      <header className="flex h-11 items-center px-3 md:h-12 md:px-4 xl:px-5">
        <p className="text-sm font-medium uppercase tracking-[0.05em] text-[var(--text-secondary)]">
          Light
        </p>
      </header>

      <PhotoGrid photos={photos} />
    </main>
  );
}