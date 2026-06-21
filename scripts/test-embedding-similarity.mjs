import { createClient } from "@supabase/supabase-js";
import {
  calculateCosineSimilarity,
  getEmbeddingMagnitude,
  validateEmbedding,
} from "./lib/embeddings.mjs";

const DEFAULT_PUBLIC_ID = "71_w9dc9x";
const DEFAULT_RESULT_LIMIT = 5;

function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    );
  }

  return value;
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

function parseOptions(args) {
  const publicIdArgument = args.find(
    (argument) =>
      argument.startsWith("--public-id="),
  );

  const limitArgument = args.find(
    (argument) =>
      argument.startsWith("--limit="),
  );

  const publicId = publicIdArgument
    ? publicIdArgument
        .slice("--public-id=".length)
        .trim()
    : DEFAULT_PUBLIC_ID;

  if (!publicId) {
    throw new Error(
      "--public-id cannot be empty.",
    );
  }

  let limit = DEFAULT_RESULT_LIMIT;

  if (limitArgument) {
    limit = Number.parseInt(
      limitArgument.slice("--limit=".length),
      10,
    );

    if (
      !Number.isInteger(limit) ||
      limit < 1
    ) {
      throw new Error(
        "--limit must be a positive whole number.",
      );
    }
  }

  return {
    publicId,
    limit,
  };
}

function parseEmbedding(value) {
  if (Array.isArray(value)) {
    const embedding = value.map(Number);
    validateEmbedding(embedding);

    return embedding;
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();

    if (
      trimmedValue.startsWith("{") &&
      trimmedValue.endsWith("}")
    ) {
      const content = trimmedValue.slice(
        1,
        -1,
      );

      const embedding = content
        .split(",")
        .map(Number);

      validateEmbedding(embedding);

      return embedding;
    }
  }

  throw new Error(
    "Supabase returned an unsupported embedding format.",
  );
}

function createLabel(photo) {
  return (
    photo.filename ??
    photo.cloudinary_public_id
  );
}

function createPairResults(photos) {
  const pairs = [];

  for (
    let firstIndex = 0;
    firstIndex < photos.length;
    firstIndex += 1
  ) {
    for (
      let secondIndex =
        firstIndex + 1;
      secondIndex < photos.length;
      secondIndex += 1
    ) {
      const firstPhoto =
        photos[firstIndex];

      const secondPhoto =
        photos[secondIndex];

      pairs.push({
        first:
          createLabel(firstPhoto),
        second:
          createLabel(secondPhoto),
        score:
          calculateCosineSimilarity(
            firstPhoto.embedding,
            secondPhoto.embedding,
          ),
      });
    }
  }

  return pairs;
}

const supabase = createClient(
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

async function fetchPhotos() {
  const { data, error } =
    await supabase
      .from("photos")
      .select(
        [
          "cloudinary_public_id",
          "filename",
          "embedding",
          "embedding_processed",
        ].join(","),
      )
      .eq(
        "embedding_processed",
        true,
      )
      .not(
        "embedding",
        "is",
        null,
      )
      .order(
        "cloudinary_public_id",
        {
          ascending: true,
        },
      );

  if (error) {
    throw new Error(
      formatError(error),
    );
  }

  return (data ?? []).map(
    (photo) => ({
      ...photo,
      embedding:
        parseEmbedding(
          photo.embedding,
        ),
    }),
  );
}

async function main() {
  const options = parseOptions(
    process.argv.slice(2),
  );

  console.log(
    "Loading stored embeddings...\n",
  );

  const photos =
    await fetchPhotos();

  if (photos.length < 2) {
    throw new Error(
      "At least two completed embeddings are required.",
    );
  }

  console.log(
    `Completed embeddings: ${photos.length}`,
  );

  const invalidMagnitudes =
    photos.filter((photo) => {
      const magnitude =
        getEmbeddingMagnitude(
          photo.embedding,
        );

      return (
        Math.abs(magnitude - 1) >
        0.000001
      );
    });

  console.log(
    `Non-unit embeddings: ${invalidMagnitudes.length}`,
  );

  const selectedPhoto =
    photos.find(
      (photo) =>
        photo.cloudinary_public_id ===
        options.publicId,
    );

  if (!selectedPhoto) {
    throw new Error(
      `Photo not found or embedding incomplete: ${options.publicId}`,
    );
  }

  const selectedMatches = photos
    .filter(
      (photo) =>
        photo.cloudinary_public_id !==
        selectedPhoto.cloudinary_public_id,
    )
    .map((photo) => ({
      filename:
        createLabel(photo),
      publicId:
        photo.cloudinary_public_id,
      similarity:
        calculateCosineSimilarity(
          selectedPhoto.embedding,
          photo.embedding,
        ),
    }))
    .sort(
      (first, second) =>
        second.similarity -
        first.similarity,
    );

  console.log(
    `\nNearest photographs to ${createLabel(
      selectedPhoto,
    )}:`,
  );

  console.table(
    selectedMatches
      .slice(0, options.limit)
      .map((result, index) => ({
        rank: index + 1,
        filename:
          result.filename,
        similarity:
          result.similarity.toFixed(
            6,
          ),
      })),
  );

  const allPairs =
    createPairResults(photos);

  const descendingPairs = [
    ...allPairs,
  ].sort(
    (first, second) =>
      second.score - first.score,
  );

  const ascendingPairs = [
    ...allPairs,
  ].sort(
    (first, second) =>
      first.score - second.score,
  );

  console.log(
    "\nHighest-scoring pairs:",
  );

  console.table(
    descendingPairs
      .slice(0, options.limit)
      .map((pair, index) => ({
        rank: index + 1,
        first: pair.first,
        second: pair.second,
        similarity:
          pair.score.toFixed(6),
      })),
  );

  console.log(
    "\nLowest-scoring pairs:",
  );

  console.table(
    ascendingPairs
      .slice(0, options.limit)
      .map((pair, index) => ({
        rank: index + 1,
        first: pair.first,
        second: pair.second,
        similarity:
          pair.score.toFixed(6),
      })),
  );

  console.log(
    "\nSimilarity range:",
  );

  console.table({
    uniquePairs:
      allPairs.length,
    highest:
      descendingPairs[0].score.toFixed(
        6,
      ),
    lowest:
      ascendingPairs[0].score.toFixed(
        6,
      ),
  });

  console.log(
    "\nSimilarity test complete. Nothing was written to Supabase.",
  );
}

main().catch((error) => {
  console.error(
    "\nSimilarity test failed.",
  );

  console.error(
    formatError(error),
  );

  process.exitCode = 1;
});