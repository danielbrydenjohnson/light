import GalleryExperience from "@/components/GalleryExperience";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import type { Photo, TileSize } from "@/types/photo";
import { unstable_cache } from "next/cache";

type SupabasePhotoRow = {
  id: string;
  cloudinary_url: string;
  filename: string;
  title: string | null;
  location: string | null;
  dominant_colour_hue: number | null;
  tile_size: TileSize;
  width: number;
  height: number;
  exif_camera: string | null;
  exif_lens: string | null;
  exif_focal_length: string | null;
  exif_aperture: string | null;
  exif_shutter_speed: string | null;
  exif_iso: string | null;
  date_taken: string | null;
  embedding: number[] | null;
};

function mapPhotoRow(row: SupabasePhotoRow): Photo {
  return {
    id: row.id,
    url: row.cloudinary_url,
    filename: row.filename,
    title: row.title ?? row.filename,
    location: row.location,
    dominant_hue: row.dominant_colour_hue,
    tile_size: row.tile_size,
    width: row.width,
    height: row.height,
    exif_camera: row.exif_camera,
    exif_lens: row.exif_lens,
    exif_focal_length: row.exif_focal_length,
    exif_aperture: row.exif_aperture,
    exif_shutter_speed: row.exif_shutter_speed,
    exif_iso: row.exif_iso,
    date_taken: row.date_taken,
    embedding: Array.isArray(row.embedding)
      ? row.embedding
      : [],
  };
}

const getPhotos = unstable_cache(
  async (): Promise<Photo[]> => {
    const supabase =
      createPublicSupabaseClient();

    const { data, error } = await supabase
      .from("photos")
      .select(
        `
          id,
          cloudinary_url,
          filename,
          title,
          location,
          dominant_colour_hue,
          tile_size,
          width,
          height,
          exif_camera,
          exif_lens,
          exif_focal_length,
          exif_aperture,
          exif_shutter_speed,
          exif_iso,
          date_taken,
          embedding
        `,
      )
      .order("order_position", {
        ascending: true,
      });

    if (error) {
      console.error(
        "Failed to load photos from Supabase:",
        error,
      );

      throw new Error(
        "Failed to load photography portfolio.",
      );
    }

    return (
      data as SupabasePhotoRow[]
    ).map(mapPhotoRow);
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
    <GalleryExperience photos={photos} />
  );
}