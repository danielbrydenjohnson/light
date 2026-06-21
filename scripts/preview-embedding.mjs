import { v2 as cloudinary } from "cloudinary";
import {
  EMBEDDING_MODEL_ID,
  createImageEmbedding,
  getEmbeddingMagnitude,
  loadEmbeddingPipeline,
} from "./lib/embeddings.mjs";

const ASSET_FOLDER = "light";
const CLOUDINARY_PAGE_SIZE = 100;
const IMAGE_MAX_WIDTH = 1568;

function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    );
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
    throw new Error(
      "--public-id cannot be empty.",
    );
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

async function fetchAllCloudinaryAssets(
  assetFolder,
) {
  const assets = [];
  let nextCursor;

  do {
    const response =
      await cloudinary.api.resources_by_asset_folder(
        assetFolder,
        {
          resource_type: "image",
          type: "upload",
          max_results:
            CLOUDINARY_PAGE_SIZE,
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

function createEmbeddingUrl(asset) {
  return cloudinary.url(
    asset.public_id,
    {
      secure: true,
      resource_type: "image",
      type: "upload",
      width: IMAGE_MAX_WIDTH,
      crop: "limit",
      quality: "auto:good",
      fetch_format: "jpg",
    },
  );
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
    createEmbeddingUrl(asset);

  console.log(`Selected: ${filename}`);
  console.log(
    `Public ID: ${asset.public_id}`,
  );

  console.log(
    `\nLoading model: ${EMBEDDING_MODEL_ID}`,
  );

  const {
    processor,
    model,
  } = await loadEmbeddingPipeline();

  console.log(
    "Generating image embedding...",
  );

  const result =
    await createImageEmbedding({
      processor,
      model,
      imageUrl,
    });

  const minimumValue = Math.min(
    ...result.embedding,
  );

  const maximumValue = Math.max(
    ...result.embedding,
  );

  console.log("\nEmbedding preview:");

  console.table({
    model: EMBEDDING_MODEL_ID,
    tensorDimensions:
      JSON.stringify(
        result.tensorDimensions,
      ),
    tensorType:
      result.tensorType,
    vectorLength:
      result.embedding.length,
    rawMagnitude:
      result.rawMagnitude.toFixed(6),
    normalisedMagnitude:
      result.normalisedMagnitude.toFixed(6),
    verifiedMagnitude:
      getEmbeddingMagnitude(
        result.embedding,
      ).toFixed(6),
    minimumValue:
      minimumValue.toFixed(6),
    maximumValue:
      maximumValue.toFixed(6),
  });

  console.log(
    "\nFirst 10 normalised values:",
  );

  console.log(
    result.embedding
      .slice(0, 10)
      .map((value) =>
        Number(value.toFixed(8)),
      ),
  );

  console.log(
    "\nPreview complete. Nothing was written to Supabase.",
  );
}

main().catch((error) => {
  console.error(
    "\nEmbedding preview failed.",
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});