import { createClient } from "@supabase/supabase-js";

const TEMPORARY_POSITION_OFFSET = 10000;
const RED_WRAP_START = 345;

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

function createCircularHueSortValue(hue) {
  return hue >= RED_WRAP_START ? hue - 360 : hue;
}

function comparePhotos(first, second) {
  const hueDifference =
    createCircularHueSortValue(first.dominant_colour_hue) -
    createCircularHueSortValue(second.dominant_colour_hue);

  if (hueDifference !== 0) {
    return hueDifference;
  }

  const saturationDifference =
    second.dominant_colour_saturation -
    first.dominant_colour_saturation;

  if (saturationDifference !== 0) {
    return saturationDifference;
  }

  return (
    first.dominant_colour_lightness -
    second.dominant_colour_lightness
  );
}

async function fetchPhotos() {
  const { data, error } = await supabase
    .from("photos")
    .select(
      `
        id,
        cloudinary_public_id,
        dominant_colour_hue,
        dominant_colour_saturation,
        dominant_colour_lightness,
        order_position
      `,
    );

  if (error) {
    throw error;
  }

  return data ?? [];
}

function validatePhotos(photos) {
  const incompletePhotos = photos.filter(
    (photo) =>
      photo.dominant_colour_hue === null ||
      photo.dominant_colour_saturation === null ||
      photo.dominant_colour_lightness === null,
  );

  if (incompletePhotos.length > 0) {
    console.table(
      incompletePhotos.map((photo) => ({
        publicId: photo.cloudinary_public_id,
      })),
    );

    throw new Error(
      `${incompletePhotos.length} photo(s) are missing colour metadata.`,
    );
  }
}

async function updatePosition(id, orderPosition) {
  const { error } = await supabase
    .from("photos")
    .update({
      order_position: orderPosition,
    })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

async function main() {
  console.log("Loading photos from Supabase...");

  const photos = await fetchPhotos();

  if (photos.length === 0) {
    console.log("No photos found.");
    return;
  }

  validatePhotos(photos);

  const orderedPhotos = [...photos].sort(comparePhotos);

  console.log(`Photos ready for ordering: ${orderedPhotos.length}`);
  console.log(
    `Red hues from ${RED_WRAP_START}° to 360° will be placed before orange.`,
  );

  console.log("\nMoving existing positions into a temporary range...");

  for (let index = 0; index < orderedPhotos.length; index += 1) {
    const photo = orderedPhotos[index];

    await updatePosition(
      photo.id,
      TEMPORARY_POSITION_OFFSET + index,
    );
  }

  console.log("Applying final colour order...");

  for (let index = 0; index < orderedPhotos.length; index += 1) {
    const photo = orderedPhotos[index];

    await updatePosition(photo.id, index);
  }

  console.log("\nColour ordering complete.");
  console.log(`Photos ordered: ${orderedPhotos.length}`);

  console.table(
    orderedPhotos.map((photo, index) => ({
      position: index,
      publicId: photo.cloudinary_public_id,
      hue: photo.dominant_colour_hue,
      saturation: photo.dominant_colour_saturation,
      lightness: photo.dominant_colour_lightness,
    })),
  );
}

main().catch((error) => {
  console.error("\nColour ordering failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});