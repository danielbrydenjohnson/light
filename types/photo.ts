export type TileSize = "small" | "medium" | "large";

export type Photo = {
  id: string;
  url: string;
  title: string;
  dominant_hue: number;
  tile_size: TileSize;
  width: number;
  height: number;
};