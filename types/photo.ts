export type TileSize = "small" | "medium" | "large";

export type Photo = {
  id: string;
  url: string;
  filename: string;
  title: string;
  location: string | null;
  dominant_hue: number | null;
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
  embedding: number[];
};