import { v2 as cloudinary } from "cloudinary";
import { createClient } from "@supabase/supabase-js";
import {
  AI_TAG_MODEL,
  analysePhotoTags,
  createAiTagClient,
  createAiTagDatabaseUpdate,
} from "./lib/ai-tags.mjs";

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
            "mood",
            "time_of_day",
            "subjects",
            "season",
            "weather",
            "ai_processed",
          ].join(","),
        )
        .order("cloudinary_public_id", {
          ascending: true,
        })
        .range(start, end);

    if (error) {
      throw error;
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

function createVisionUrl(asset) {
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
      photo.ai_processed === true
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

function printTags(result) {
  console.log(
    `Mood: ${result.tags.mood}`,
  );

  console.log(
    `Time of day: ${
      result.tags.timeOfDay
    }`,
  );

  console.log(
    `Subjects: ${
      result.tags.subjects.join(", ")
    }`,
  );

  console.log(
    `Season: ${result.tags.season}`,
  );

  console.log(
    `Weather: ${result.tags.weather}`,
  );
}

async function writeTags({
  supabase,
  publicId,
  tags,
}) {
  const databaseUpdate =
    createAiTagDatabaseUpdate(tags);

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
    throw error;
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
  const anthropic =
    createAiTagClient(
      requireEnvironmentVariable(
        "ANTHROPIC_API_KEY",
      ),
    );

  const secretSupabase =
    createSecretSupabaseClient();

  const successfulResults = [];
  const failedResults = [];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

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
      }] Analysing ${filename}...`,
    );

    try {
      const result =
        await analysePhotoTags({
          client: anthropic,
          imageUrl:
            createVisionUrl(asset),
          filename,
        });

      printTags(result);

      await writeTags({
        supabase: secretSupabase,
        publicId:
          photo.cloudinary_public_id,
        tags: result.tags,
      });

      totalInputTokens +=
        result.usage.input_tokens;

      totalOutputTokens +=
        result.usage.output_tokens;

      successfulResults.push({
        publicId:
          photo.cloudinary_public_id,
        filename,
        ...result.tags,
      });

      console.log(
        "Saved to Supabase.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

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
    totalInputTokens,
    totalOutputTokens,
  };
}

async function main() {
  const options = parseOptions(
    process.argv.slice(2),
  );

  console.log(
    "Checking AI tagging state...\n",
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
    `Photos needing AI tags: ${
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
      "\nNo photos require AI tagging.",
    );

    console.log(
      "No data was changed.",
    );

    return;
  }

  if (!options.write) {
    console.log(
      `\n${photosToProcess.length} photo(s) are ready for AI tagging.`,
    );

    console.log(
      "Run with --write to analyse and save them.",
    );

    console.log(
      "No data was changed.",
    );

    return;
  }

  if (options.rewrite) {
    console.log(
      "\nRewrite mode: existing AI tags will be replaced.",
    );
  }

  if (options.limit !== null) {
    console.log(
      `\nLimit applied: processing ${
        photosToProcess.length
      } photo(s).`,
    );
  }

  console.log(
    `\nUsing model: ${AI_TAG_MODEL}`,
  );

  const {
    successfulResults,
    failedResults,
    totalInputTokens,
    totalOutputTokens,
  } = await processPhotos(
    photosToProcess,
  );

  console.log(
    "\nAI tagging summary:",
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

  console.log(
    `Input tokens: ${totalInputTokens}`,
  );

  console.log(
    `Output tokens: ${totalOutputTokens}`,
  );

  if (
    successfulResults.length > 0
  ) {
    console.log(
      "\nSaved metadata:",
    );

    console.table(
      successfulResults.map(
        (result) => ({
          filename:
            result.filename,
          mood: result.mood,
          timeOfDay:
            result.timeOfDay,
          subjects:
            result.subjects.join(", "),
          season:
            result.season,
          weather:
            result.weather,
        }),
      ),
    );
  }

  if (failedResults.length > 0) {
    console.log(
      "\nFailures:",
    );

    console.table(failedResults);
    process.exitCode = 1;
  }

  console.log(
    "\nAI tagging complete. Colour data, EXIF data and gallery order were not changed.",
  );
}

main().catch((error) => {
  console.error(
    "\nAI processing failed.",
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});