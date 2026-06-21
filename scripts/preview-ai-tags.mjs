import { v2 as cloudinary } from "cloudinary";
import {
  AI_TAG_MODEL,
  analysePhotoTags,
  createAiTagClient,
} from "./lib/ai-tags.mjs";

const ASSET_FOLDER = "light";
const CLOUDINARY_PAGE_SIZE = 100;
const IMAGE_MAX_WIDTH = 1568;

function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getRequestedPublicId(args) {
  const argument = args.find((value) =>
    value.startsWith("--public-id="),
  );

  if (!argument) {
    return null;
  }

  const publicId = argument
    .slice("--public-id=".length)
    .trim();

  if (!publicId) {
    throw new Error("--public-id cannot be empty.");
  }

  return publicId;
}

cloudinary.config({
  cloud_name: requireEnvironmentVariable(
    "CLOUDINARY_CLOUD_NAME",
  ),
  api_key: requireEnvironmentVariable(
    "CLOUDINARY_API_KEY",
  ),
  api_secret: requireEnvironmentVariable(
    "CLOUDINARY_API_SECRET",
  ),
  secure: true,
});

const anthropic = createAiTagClient(
  requireEnvironmentVariable(
    "ANTHROPIC_API_KEY",
  ),
);

async function fetchAllCloudinaryAssets(assetFolder) {
  const assets = [];
  let nextCursor;

  do {
    const response =
      await cloudinary.api.resources_by_asset_folder(
        assetFolder,
        {
          resource_type: "image",
          type: "upload",
          max_results: CLOUDINARY_PAGE_SIZE,
          next_cursor: nextCursor,
        },
      );

    assets.push(...response.resources);
    nextCursor = response.next_cursor;
  } while (nextCursor);

  return assets;
}

function selectAsset(
  assets,
  requestedPublicId,
) {
  if (assets.length === 0) {
    throw new Error(
      `No images were found in Cloudinary folder: ${ASSET_FOLDER}`,
    );
  }

  if (!requestedPublicId) {
    return assets[0];
  }

  const asset = assets.find(
    (candidate) =>
      candidate.public_id === requestedPublicId,
  );

  if (!asset) {
    throw new Error(
      `Cloudinary image not found: ${requestedPublicId}`,
    );
  }

  return asset;
}

function createVisionUrl(asset) {
  return cloudinary.url(asset.public_id, {
    secure: true,
    resource_type: "image",
    type: "upload",
    width: IMAGE_MAX_WIDTH,
    crop: "limit",
    quality: "auto:good",
    fetch_format: "jpg",
  });
}

async function main() {
  const requestedPublicId =
    getRequestedPublicId(
      process.argv.slice(2),
    );

  console.log(
    `Fetching images from Cloudinary folder: ${ASSET_FOLDER}`,
  );

  const assets =
    await fetchAllCloudinaryAssets(
      ASSET_FOLDER,
    );

  const asset = selectAsset(
    assets,
    requestedPublicId,
  );

  const filename =
    asset.display_name ??
    asset.public_id;

  const imageUrl =
    createVisionUrl(asset);

  console.log(`Selected: ${filename}`);
  console.log(
    `Public ID: ${asset.public_id}`,
  );

  console.log(
    `Sending ${filename} to ${AI_TAG_MODEL}...`,
  );

  const result = await analysePhotoTags({
    client: anthropic,
    imageUrl,
    filename,
  });

  console.log("\nClaude Vision tags:");

  console.table({
    mood: result.tags.mood,
    time_of_day:
      result.tags.timeOfDay,
    subjects:
      result.tags.subjects.join(", "),
    season: result.tags.season,
    weather: result.tags.weather,
  });

  console.log("\nRequest details:");
  console.log(`Model: ${result.model}`);
  console.log(
    `Stop reason: ${result.stopReason}`,
  );

  console.log(
    `Input tokens: ${
      result.usage.input_tokens
    }`,
  );

  console.log(
    `Output tokens: ${
      result.usage.output_tokens
    }`,
  );

  console.log(
    "\nPreview complete. Nothing was written to Supabase.",
  );
}

main().catch((error) => {
  console.error(
    "\nClaude Vision preview failed.",
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});