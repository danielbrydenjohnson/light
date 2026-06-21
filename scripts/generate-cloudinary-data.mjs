import { mkdir, writeFile } from "node:fs/promises";
import { v2 as cloudinary } from "cloudinary";

const ASSET_FOLDER = "light";
const OUTPUT_DIRECTORY = "data";
const OUTPUT_FILE = `${OUTPUT_DIRECTORY}/cloudinary-photos.json`;
const MAX_RESULTS_PER_REQUEST = 100;

function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

cloudinary.config({
  cloud_name: requireEnvironmentVariable("CLOUDINARY_CLOUD_NAME"),
  api_key: requireEnvironmentVariable("CLOUDINARY_API_KEY"),
  api_secret: requireEnvironmentVariable("CLOUDINARY_API_SECRET"),
  secure: true,
});

async function fetchAllAssetsFromFolder(assetFolder) {
  const assets = [];
  let nextCursor;

  do {
    const response = await cloudinary.api.resources_by_asset_folder(
      assetFolder,
      {
        resource_type: "image",
        type: "upload",
        max_results: MAX_RESULTS_PER_REQUEST,
        next_cursor: nextCursor,
      },
    );

    assets.push(...response.resources);
    nextCursor = response.next_cursor;
  } while (nextCursor);

  return assets;
}

function createPhotoRecord(asset, index) {
  const displayName = asset.display_name ?? asset.public_id;

  return {
    id: asset.asset_id,
    cloudinary_public_id: asset.public_id,
    cloudinary_url: asset.secure_url,
    filename: displayName,
    url: asset.secure_url,
    title: displayName,
    dominant_hue: null,
    tile_size: "small",
    width: asset.width,
    height: asset.height,
    temporary_order: index,
  };
}

async function main() {
  console.log(`Fetching images from Cloudinary folder: ${ASSET_FOLDER}`);

  const assets = await fetchAllAssetsFromFolder(ASSET_FOLDER);

  if (assets.length === 0) {
    throw new Error(`No images found in Cloudinary folder: ${ASSET_FOLDER}`);
  }

  const photos = assets.map(createPhotoRecord);

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(photos, null, 2)}\n`,
    "utf8",
  );

  console.log(`Generated ${OUTPUT_FILE}`);
  console.log(`Photos written: ${photos.length}`);
}

main().catch((error) => {
  console.error("\nCloudinary data generation failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});