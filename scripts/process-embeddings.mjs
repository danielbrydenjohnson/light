import { v2 as cloudinary } from "cloudinary";
import { createClient } from "@supabase/supabase-js";
import {
  EMBEDDING_MODEL_ID,
  createEmbeddingDatabaseUpdate,
  createImageEmbedding,
  loadEmbeddingPipeline,
} from "./lib/embeddings.mjs";

const ASSET_FOLDER = "light";
const CLOUDINARY_PAGE_SIZE = 100;
const SUPABASE_PAGE_SIZE = 1000;
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

function parseOptions(args) {
  const write = args.includes("--write");
  const rewrite = args.includes("--rewrite");

  const limitArgument = args.find((argument) =>
    argument.startsWith("--limit="),
  );

  let limit = null;

  if (limitArgument) {
    const parsedLimit = Number.parseInt(
      limitArgument.slice("--limit=".length),
      10,
    );

    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1
    ) {
      throw new Error(
        "--limit must be followed by a positive whole number.",
      );
    }

    limit = parsedLimit;
  }

  if (rewrite && !write) {
    throw new Error(
      "--rewrite must be used together with --write.",
    );
  }

  return {
    write,
    rewrite,
    limit,
  };
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null
  ) {
    const details = [
      error.message,
      error.details,
      error.hint,
      error.code,
    ].filter(Boolean);

    if (details.length > 0) {
      return details.join(" | ");
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
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

const publicSupabase = createClient(
  requireEnvironmentVariable(
    "NEXT_PUBLIC_SUPABASE_URL",
  ),
  requireEnvironmentVariable(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

function createSecretSupabaseClient() {
  return createClient(
    requireEnvironmentVariable(
      "NEXT_PUBLIC_SUPABASE_URL",
    ),
    requireEnvironmentVariable(
      "SUPABASE_SECRET_KEY",
    ),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

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

async function fetchAllSupabasePhotos() {
  const photos = [];
  let start = 0;

  while (true) {
    const end =
      start + SUPABASE_PAGE_SIZE - 1;

    const { data, error } =
      await publicSupabase
        .from("photos")
        .select(
          [
            "cloudinary_public_id",
            "filename",
            "embedding_processed",
          ].join(","),
        )
        .order("cloudinary_public_id", {
          ascending: true,
        })
        .range(start, end);

    if (error) {
      throw new Error(
        formatError(error),
      );
    }

    const rows = data ?? [];
    photos.push(...rows);

    if (
      rows.length <
      SUPABASE_PAGE_SIZE
    ) {
      break;
    }

    start += SUPABASE_PAGE_SIZE;
  }

  return photos;
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

function findPhotosForProcessing({
  assets,
  photos,
  rewrite,
}) {
  const assetsByPublicId = new Map(
    assets.map((asset) => [
      asset.public_id,
      asset,
    ]),
  );

  const matchedPhotos = [];
  const missingAssets = [];

  for (const photo of photos) {
    if (
      !rewrite &&
      photo.embedding_processed === true
    ) {
      continue;
    }

    const asset = assetsByPublicId.get(
      photo.cloudinary_public_id,
    );

    if (!asset) {
      missingAssets.push(
        photo.cloudinary_public_id,
      );

      continue;
    }

    matchedPhotos.push({
      photo,
      asset,
    });
  }

  return {
    matchedPhotos,
    missingAssets,
  };
}

async function writeEmbedding({
  supabase,
  publicId,
  embedding,
}) {
  const databaseUpdate =
    createEmbeddingDatabaseUpdate(
      embedding,
    );

  const { data, error } =
    await supabase
      .from("photos")
      .update(databaseUpdate)
      .eq(
        "cloudinary_public_id",
        publicId,
      )
      .select("cloudinary_public_id");

  if (error) {
    throw new Error(
      formatError(error),
    );
  }

  if (
    !data ||
    data.length !== 1
  ) {
    throw new Error(
      `Expected one updated row but received ${
        data?.length ?? 0
      }.`,
    );
  }
}

async function processPhotos(
  matchedPhotos,
) {
  console.log(
    `\nLoading model: ${EMBEDDING_MODEL_ID}`,
  );

  const {
    processor,
    model,
  } = await loadEmbeddingPipeline();

  console.log(
    "Model loaded.",
  );

  const secretSupabase =
    createSecretSupabaseClient();

  const successfulResults = [];
  const failedResults = [];

  for (
    let index = 0;
    index < matchedPhotos.length;
    index += 1
  ) {
    const {
      photo,
      asset,
    } = matchedPhotos[index];

    const filename =
      photo.filename ??
      asset.display_name ??
      asset.public_id;

    console.log(
      `\n[${index + 1}/${
        matchedPhotos.length
      }] Generating embedding for ${filename}...`,
    );

    try {
      const result =
        await createImageEmbedding({
          processor,
          model,
          imageUrl:
            createEmbeddingUrl(asset),
        });

      await writeEmbedding({
        supabase: secretSupabase,
        publicId:
          photo.cloudinary_public_id,
        embedding:
          result.embedding,
      });

      successfulResults.push({
        publicId:
          photo.cloudinary_public_id,
        filename,
        dimensions:
          result.embedding.length,
        magnitude:
          result.normalisedMagnitude,
      });

      console.log(
        `Dimensions: ${
          result.embedding.length
        }`,
      );

      console.log(
        `Magnitude: ${
          result.normalisedMagnitude.toFixed(
            6,
          )
        }`,
      );

      console.log(
        "Saved to Supabase.",
      );
    } catch (error) {
      const message =
        formatError(error);

      failedResults.push({
        publicId:
          photo.cloudinary_public_id,
        filename,
        error: message,
      });

      console.error(
        `Failed: ${message}`,
      );
    }
  }

  return {
    successfulResults,
    failedResults,
  };
}

async function main() {
  const options = parseOptions(
    process.argv.slice(2),
  );

  console.log(
    "Checking embedding state...\n",
  );

  const [
    cloudinaryAssets,
    supabasePhotos,
  ] = await Promise.all([
    fetchAllCloudinaryAssets(
      ASSET_FOLDER,
    ),
    fetchAllSupabasePhotos(),
  ]);

  const {
    matchedPhotos,
    missingAssets,
  } = findPhotosForProcessing({
    assets: cloudinaryAssets,
    photos: supabasePhotos,
    rewrite: options.rewrite,
  });

  const photosToProcess =
    options.limit === null
      ? matchedPhotos
      : matchedPhotos.slice(
          0,
          options.limit,
        );

  console.log(
    `Cloudinary images: ${
      cloudinaryAssets.length
    }`,
  );

  console.log(
    `Supabase photo rows: ${
      supabasePhotos.length
    }`,
  );

  console.log(
    `Photos needing embeddings: ${
      matchedPhotos.length
    }`,
  );

  console.log(
    `Supabase rows missing from Cloudinary: ${
      missingAssets.length
    }`,
  );

  if (missingAssets.length > 0) {
    console.log(
      "\nWarning: these Supabase rows have no matching Cloudinary image:",
    );

    console.table(
      missingAssets.map(
        (publicId) => ({
          publicId,
        }),
      ),
    );
  }

  if (photosToProcess.length === 0) {
    console.log(
      "\nNo photos require embedding generation.",
    );

    console.log(
      "No data was changed.",
    );

    return;
  }

  if (!options.write) {
    console.log(
      `\n${photosToProcess.length} photo(s) are ready for embedding generation.`,
    );

    console.log(
      "Run with --write to generate and save them.",
    );

    console.log(
      "No data was changed.",
    );

    return;
  }

  if (options.rewrite) {
    console.log(
      "\nRewrite mode: existing embeddings will be replaced.",
    );
  }

  if (options.limit !== null) {
    console.log(
      `\nLimit applied: processing ${
        photosToProcess.length
      } photo(s).`,
    );
  }

  const {
    successfulResults,
    failedResults,
  } = await processPhotos(
    photosToProcess,
  );

  console.log(
    "\nEmbedding summary:",
  );

  console.log(
    `Successful: ${
      successfulResults.length
    }`,
  );

  console.log(
    `Failed: ${
      failedResults.length
    }`,
  );

  if (
    successfulResults.length > 0
  ) {
    console.log(
      "\nSaved embeddings:",
    );

    console.table(
      successfulResults.map(
        (result) => ({
          filename:
            result.filename,
          dimensions:
            result.dimensions,
          magnitude:
            result.magnitude.toFixed(
              6,
            ),
        }),
      ),
    );
  }

  if (failedResults.length > 0) {
    console.log(
      "\nFailures:",
    );

    console.table(
      failedResults,
    );

    process.exitCode = 1;
  }

  console.log(
    "\nEmbedding generation complete. Colours, EXIF data, AI tags and gallery order were not changed.",
  );
}

main().catch((error) => {
  console.error(
    "\nEmbedding processing failed.",
  );

  console.error(
    formatError(error),
  );

  process.exitCode = 1;
});