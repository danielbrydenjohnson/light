import PhotoGrid from "@/components/PhotoGrid";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import type { Photo, TileSize } from "@/types/photo";
import { unstable_cache } from "next/cache";

type SupabasePhotoRow = {
  id: string;
  cloudinary_url: string;
  filename: string;
  title: string | null;
  dominant_colour_hue: number | null;
  tile_size: TileSize;
  width: number;
  height: number;
};

function mapPhotoRow(row: SupabasePhotoRow): Photo {
  return {
    id: row.id,
    url: row.cloudinary_url,
    title: row.title ?? row.filename,
    dominant_hue: row.dominant_colour_hue,
    tile_size: row.tile_size,
    width: row.width,
    height: row.height,
  };
}

const getPhotos = unstable_cache(
  async (): Promise<Photo[]> => {
    const supabase = createPublicSupabaseClient();

    const { data, error } = await supabase
      .from("photos")
      .select(
        `
          id,
          cloudinary_url,
          filename,
          title,
          dominant_colour_hue,
          tile_size,
          width,
          height
        `,
      )
      .order("order_position", { ascending: true });

    if (error) {
      console.error("Failed to load photos from Supabase:", error);
      throw new Error("Failed to load photography portfolio.");
    }

    return (data as SupabasePhotoRow[]).map(mapPhotoRow);
  },
  ["public-photos"],
  {
    revalidate: 60,
    tags: ["photos"],
  },
);

export default async function Home() {
  const photos = await getPhotos();

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