import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const PHOTO_DATA_FILE = "data/cloudinary-photos.json";

function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const supabase = createClient(
  requireEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnvironmentVariable("SUPABASE_SECRET_KEY"),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

async function loadGeneratedPhotos() {
  const fileContents = await readFile(PHOTO_DATA_FILE, "utf8");
  const photos = JSON.parse(fileContents);

  if (!Array.isArray(photos) || photos.length === 0) {
    throw new Error(`No photos found in ${PHOTO_DATA_FILE}`);
  }

  return photos;
}

function createDatabaseRecord(photo) {
  return {
    cloudinary_public_id: photo.cloudinary_public_id,
    cloudinary_url: photo.cloudinary_url,
    filename: photo.filename,
    width: photo.width,
    height: photo.height,
    order_position: photo.temporary_order,
    tile_size: photo.tile_size,
    title: photo.title,
  };
}

async function main() {
  console.log(`Loading photos from ${PHOTO_DATA_FILE}...`);

  const photos = await loadGeneratedPhotos();
  const databaseRecords = photos.map(createDatabaseRecord);

  console.log(`Synchronising ${databaseRecords.length} photos to Supabase...`);

  const { error: writeError } = await supabase
    .from("photos")
    .upsert(databaseRecords, {
      onConflict: "cloudinary_public_id",
    });

  if (writeError) {
    throw writeError;
  }

  const { count, error: countError } = await supabase
    .from("photos")
    .select("id", {
      count: "exact",
      head: true,
    });

  if (countError) {
    throw countError;
  }

  console.log("Supabase synchronisation successful.");
  console.log(`Rows currently stored: ${count ?? 0}`);
}

main().catch((error) => {
  console.error("\nSupabase synchronisation failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});