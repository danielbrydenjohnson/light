import PhotoGrid from "@/components/PhotoGrid";
import cloudinaryPhotos from "@/data/cloudinary-photos.json";
import type { Photo } from "@/types/photo";

type CloudinaryPhoto = Photo & {
  temporary_order: number;
};

export default function Home() {
  const photos = [...(cloudinaryPhotos as CloudinaryPhoto[])].sort(
    (firstPhoto, secondPhoto) =>
      firstPhoto.temporary_order - secondPhoto.temporary_order,
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