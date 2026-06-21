import { v2 as cloudinary } from "cloudinary";

const ASSET_FOLDER = "light";
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

async function main() {
  console.log(`Fetching images from Cloudinary folder: ${ASSET_FOLDER}`);

  const assets = await fetchAllAssetsFromFolder(ASSET_FOLDER);

  if (assets.length === 0) {
    console.log("No images found.");
    return;
  }

  console.log(`Found ${assets.length} images.\n`);

  const rows = assets.map((asset) => ({
    filename: asset.display_name ?? asset.public_id,
    publicId: asset.public_id,
    dimensions: `${asset.width} × ${asset.height}`,
    format: asset.format,
    folder: asset.asset_folder ?? "",
    url: asset.secure_url,
  }));

  console.table(rows);
}

main().catch((error) => {
  console.error("\nCloudinary listing failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});