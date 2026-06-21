import { v2 as cloudinary } from "cloudinary";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  countPopulatedExifFields,
  createExifDatabaseUpdate,
  extractExifMetadata,
} from "./lib/exif.mjs";

const ASSET_FOLDER = "light";
const CLOUDINARY_PAGE_SIZE = 100;
const SUPABASE_PAGE_SIZE = 1000;

const DOWNLOAD_MAX_WIDTH = 800;
const ANALYSIS_SIZE = 160;
const PALETTE_SIZE = 5;
const COLOUR_BUCKET_SIZE = 24;

const MIN_LIGHTNESS = 6;
const MAX_LIGHTNESS = 94;
const MIN_SATURATION = 8;

function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseCommandOptions(args) {
  const previewArgument = args.find(
    (argument) =>
      argument === "--preview-existing" ||
      argument.startsWith("--preview-existing="),
  );

  const writeColours = args.includes("--write-colours");
  const rewriteColours = args.includes("--rewrite-colours");

  const writeExif = args.includes("--write-exif");
  const rewriteExif = args.includes("--rewrite-exif");

  let previewExistingLimit = 0;

  if (previewArgument === "--preview-existing") {
    previewExistingLimit = 3;
  } else if (previewArgument) {
    const value = previewArgument.split("=")[1];
    const parsedLimit = Number.parseInt(value, 10);

    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      throw new Error(
        "--preview-existing must be followed by a positive whole number.",
      );
    }

    previewExistingLimit = parsedLimit;
  }

  const activeWriteModes = [
    writeColours,
    writeExif,
  ].filter(Boolean).length;

  if (activeWriteModes > 1) {
    throw new Error(
      "Use only one write mode at a time: --write-colours or --write-exif.",
    );
  }

  if (
    previewExistingLimit > 0 &&
    (writeColours || writeExif)
  ) {
    throw new Error(
      "--preview-existing cannot be used with a write mode.",
    );
  }

  if (rewriteColours && !writeColours) {
    throw new Error(
      "--rewrite-colours must be used together with --write-colours.",
    );
  }

  if (rewriteExif && !writeExif) {
    throw new Error(
      "--rewrite-exif must be used together with --write-exif.",
    );
  }

  return {
    previewExistingLimit,
    writeColours,
    rewriteColours,
    writeExif,
    rewriteExif,
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

async function fetchAllSupabasePhotos() {
  const photos = [];
  let start = 0;

  while (true) {
    const end = start + SUPABASE_PAGE_SIZE - 1;

    const { data, error } = await publicSupabase
      .from("photos")
      .select(
        [
          "cloudinary_public_id",
          "dominant_colour_hex",
          "dominant_colour_hue",
          "dominant_colour_saturation",
          "dominant_colour_lightness",
          "colour_palette",
          "exif_camera",
          "exif_lens",
          "exif_focal_length",
          "exif_aperture",
          "exif_shutter_speed",
          "exif_iso",
          "date_taken",
          "exif_processed",
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

    if (rows.length < SUPABASE_PAGE_SIZE) {
      break;
    }

    start += SUPABASE_PAGE_SIZE;
  }

  return photos;
}

function findNewCloudinaryAssets(
  cloudinaryAssets,
  supabasePhotos,
) {
  const existingPublicIds = new Set(
    supabasePhotos.map(
      (photo) => photo.cloudinary_public_id,
    ),
  );

  return cloudinaryAssets.filter(
    (asset) =>
      !existingPublicIds.has(asset.public_id),
  );
}

function findMissingCloudinaryAssets(
  cloudinaryAssets,
  supabasePhotos,
) {
  const cloudinaryPublicIds = new Set(
    cloudinaryAssets.map(
      (asset) => asset.public_id,
    ),
  );

  return supabasePhotos
    .map((photo) => photo.cloudinary_public_id)
    .filter(
      (publicId) =>
        !cloudinaryPublicIds.has(publicId),
    );
}

function photoNeedsColourProcessing(photo) {
  const paletteIsMissing =
    !Array.isArray(photo.colour_palette) ||
    photo.colour_palette.length === 0;

  return (
    !photo.dominant_colour_hex ||
    photo.dominant_colour_hue === null ||
    photo.dominant_colour_saturation === null ||
    photo.dominant_colour_lightness === null ||
    paletteIsMissing
  );
}

function findAssetsNeedingColourProcessing(
  cloudinaryAssets,
  supabasePhotos,
  rewriteColours,
) {
  const assetsByPublicId = new Map(
    cloudinaryAssets.map((asset) => [
      asset.public_id,
      asset,
    ]),
  );

  return supabasePhotos
    .filter(
      (photo) =>
        rewriteColours ||
        photoNeedsColourProcessing(photo),
    )
    .map((photo) =>
      assetsByPublicId.get(
        photo.cloudinary_public_id,
      ),
    )
    .filter(Boolean);
}

function findAssetsNeedingExifProcessing(
  cloudinaryAssets,
  supabasePhotos,
  rewriteExif,
) {
  const assetsByPublicId = new Map(
    cloudinaryAssets.map((asset) => [
      asset.public_id,
      asset,
    ]),
  );

  return supabasePhotos
    .filter(
      (photo) =>
        rewriteExif ||
        photo.exif_processed !== true,
    )
    .map((photo) =>
      assetsByPublicId.get(
        photo.cloudinary_public_id,
      ),
    )
    .filter(Boolean);
}

function createAssetSummary(asset) {
  return {
    filename:
      asset.display_name ?? asset.public_id,
    publicId: asset.public_id,
    dimensions:
      `${asset.width} × ${asset.height}`,
    format: asset.format,
  };
}

function createAnalysisUrl(asset) {
  return cloudinary.url(asset.public_id, {
    secure: true,
    resource_type: "image",
    type: "upload",
    width: DOWNLOAD_MAX_WIDTH,
    crop: "limit",
    quality: "auto:good",
    fetch_format: "jpg",
  });
}

async function downloadImageFromUrl(
  imageUrl,
  publicId,
) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(
      `Image download failed with status ${response.status}: ${publicId}`,
    );
  }

  return Buffer.from(
    await response.arrayBuffer(),
  );
}

async function downloadAnalysisImage(asset) {
  return downloadImageFromUrl(
    createAnalysisUrl(asset),
    asset.public_id,
  );
}

async function downloadOriginalImage(asset) {
  if (!asset.secure_url) {
    throw new Error(
      `No original Cloudinary URL found for ${asset.public_id}.`,
    );
  }

  return downloadImageFromUrl(
    asset.secure_url,
    asset.public_id,
  );
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) =>
      Math.round(value)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

function rgbToHsl(red, green, blue) {
  const normalisedRed = red / 255;
  const normalisedGreen = green / 255;
  const normalisedBlue = blue / 255;

  const maximum = Math.max(
    normalisedRed,
    normalisedGreen,
    normalisedBlue,
  );

  const minimum = Math.min(
    normalisedRed,
    normalisedGreen,
    normalisedBlue,
  );

  const difference = maximum - minimum;
  const lightness = (maximum + minimum) / 2;

  let hue = 0;
  let saturation = 0;

  if (difference !== 0) {
    saturation =
      lightness > 0.5
        ? difference /
          (2 - maximum - minimum)
        : difference /
          (maximum + minimum);

    if (maximum === normalisedRed) {
      hue =
        (normalisedGreen - normalisedBlue) /
          difference +
        (
          normalisedGreen < normalisedBlue
            ? 6
            : 0
        );
    } else if (
      maximum === normalisedGreen
    ) {
      hue =
        (normalisedBlue - normalisedRed) /
          difference +
        2;
    } else {
      hue =
        (normalisedRed - normalisedGreen) /
          difference +
        4;
    }

    hue *= 60;
  }

  return {
    hue,
    saturation: saturation * 100,
    lightness: lightness * 100,
  };
}

function calculatePixelWeight(
  saturation,
  lightness,
) {
  const saturationWeight =
    0.25 + 0.75 * (saturation / 100);

  const distanceFromMidLightness =
    Math.abs(lightness - 50) / 50;

  const lightnessWeight =
    0.7 +
    0.3 * (1 - distanceFromMidLightness);

  return (
    saturationWeight * lightnessWeight
  );
}

function createColourBuckets(
  data,
  info,
  relaxedFiltering = false,
) {
  const buckets = new Map();

  for (
    let index = 0;
    index < data.length;
    index += info.channels
  ) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];

    const alpha =
      info.channels === 4
        ? data[index + 3]
        : 255;

    if (alpha < 128) {
      continue;
    }

    const {
      saturation,
      lightness,
    } = rgbToHsl(red, green, blue);

    if (
      !relaxedFiltering &&
      (
        lightness < MIN_LIGHTNESS ||
        lightness > MAX_LIGHTNESS ||
        saturation < MIN_SATURATION
      )
    ) {
      continue;
    }

    const redBucket = Math.floor(
      red / COLOUR_BUCKET_SIZE,
    );

    const greenBucket = Math.floor(
      green / COLOUR_BUCKET_SIZE,
    );

    const blueBucket = Math.floor(
      blue / COLOUR_BUCKET_SIZE,
    );

    const bucketKey =
      `${redBucket}:` +
      `${greenBucket}:` +
      `${blueBucket}`;

    const pixelWeight = relaxedFiltering
      ? 1
      : calculatePixelWeight(
          saturation,
          lightness,
        );

    const existingBucket =
      buckets.get(bucketKey) ?? {
        pixelCount: 0,
        weightedScore: 0,
        redTotal: 0,
        greenTotal: 0,
        blueTotal: 0,
      };

    existingBucket.pixelCount += 1;
    existingBucket.weightedScore +=
      pixelWeight;
    existingBucket.redTotal += red;
    existingBucket.greenTotal += green;
    existingBucket.blueTotal += blue;

    buckets.set(
      bucketKey,
      existingBucket,
    );
  }

  return [...buckets.values()]
    .map((bucket) => {
      const red =
        bucket.redTotal /
        bucket.pixelCount;

      const green =
        bucket.greenTotal /
        bucket.pixelCount;

      const blue =
        bucket.blueTotal /
        bucket.pixelCount;

      return {
        red,
        green,
        blue,
        pixelCount: bucket.pixelCount,
        weightedScore:
          bucket.weightedScore,
      };
    })
    .sort(
      (first, second) =>
        second.weightedScore -
        first.weightedScore,
    );
}

function calculateColourDistance(
  first,
  second,
) {
  const redDifference =
    first.red - second.red;

  const greenDifference =
    first.green - second.green;

  const blueDifference =
    first.blue - second.blue;

  return Math.sqrt(
    redDifference ** 2 +
      greenDifference ** 2 +
      blueDifference ** 2,
  );
}

function selectPalette(
  colourBuckets,
  paletteSize,
) {
  const selectedColours = [];
  const distanceThresholds = [55, 32, 0];

  for (
    const threshold of distanceThresholds
  ) {
    for (
      const candidate of colourBuckets
    ) {
      if (
        selectedColours.includes(candidate)
      ) {
        continue;
      }

      const isDistinctEnough =
        selectedColours.every(
          (selectedColour) =>
            calculateColourDistance(
              candidate,
              selectedColour,
            ) >= threshold,
        );

      if (isDistinctEnough) {
        selectedColours.push(candidate);
      }

      if (
        selectedColours.length ===
        paletteSize
      ) {
        return selectedColours;
      }
    }
  }

  return selectedColours;
}

function extractColourPalette(data, info) {
  let colourBuckets =
    createColourBuckets(
      data,
      info,
      false,
    );

  let filteringMode = "filtered";

  if (colourBuckets.length === 0) {
    colourBuckets =
      createColourBuckets(
        data,
        info,
        true,
      );

    filteringMode = "relaxed";
  }

  const selectedColours =
    selectPalette(
      colourBuckets,
      PALETTE_SIZE,
    );

  if (selectedColours.length === 0) {
    throw new Error(
      "No usable pixels were found in the image.",
    );
  }

  const palette =
    selectedColours.map((colour) => {
      const hex = rgbToHex(
        colour.red,
        colour.green,
        colour.blue,
      );

      const hsl = rgbToHsl(
        colour.red,
        colour.green,
        colour.blue,
      );

      return {
        hex,
        hue: hsl.hue,
        saturation: hsl.saturation,
        lightness: hsl.lightness,
        pixelCount:
          colour.pixelCount,
        weightedScore:
          colour.weightedScore,
      };
    });

  return {
    dominantColour: palette[0],
    palette,
    filteringMode,
  };
}

async function analyseAssetColours(asset) {
  const imageBuffer =
    await downloadAnalysisImage(asset);

  const { data, info } =
    await sharp(imageBuffer)
      .rotate()
      .resize({
        width: ANALYSIS_SIZE,
        height: ANALYSIS_SIZE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .removeAlpha()
      .raw()
      .toBuffer({
        resolveWithObject: true,
      });

  const colours =
    extractColourPalette(data, info);

  return {
    publicId: asset.public_id,
    filename:
      asset.display_name ??
      asset.public_id,
    analysedWidth: info.width,
    analysedHeight: info.height,
    ...colours,
  };
}

async function analyseAssetExif(asset) {
  const imageBuffer =
    await downloadOriginalImage(asset);

  const metadata =
    extractExifMetadata(imageBuffer);

  return {
    publicId: asset.public_id,
    filename:
      asset.display_name ??
      asset.public_id,
    metadata,
    populatedFieldCount:
      countPopulatedExifFields(metadata),
  };
}

function hexToRgb(hex) {
  const value = Number.parseInt(
    hex.slice(1),
    16,
  );

  return {
    red: (value >> 16) & 255,
    green: (value >> 8) & 255,
    blue: value & 255,
  };
}

function createColourSwatch(hex) {
  const { red, green, blue } =
    hexToRgb(hex);

  return (
    `\u001B[48;2;${red};` +
    `${green};${blue}m  ` +
    `\u001B[0m ${hex}`
  );
}

function printColourResult(result) {
  const dominant =
    result.dominantColour;

  console.log(`\n${result.filename}`);
  console.log(
    `Public ID: ${result.publicId}`,
  );

  console.log(
    `Analysis size: ` +
      `${result.analysedWidth} × ` +
      `${result.analysedHeight}`,
  );

  console.log(
    `Dominant: ${createColourSwatch(
      dominant.hex,
    )}`,
  );

  console.log(
    `HSL: ${dominant.hue.toFixed(1)}°, ` +
      `${dominant.saturation.toFixed(1)}% saturation, ` +
      `${dominant.lightness.toFixed(1)}% lightness`,
  );

  console.log(
    `Filtering: ${result.filteringMode}`,
  );

  console.log(
    `Palette: ${result.palette
      .map((colour) =>
        createColourSwatch(
          colour.hex,
        ),
      )
      .join("  ")}`,
  );
}

function printExifResult(result) {
  const { metadata } = result;

  console.log(`\n${result.filename}`);
  console.log(
    `Public ID: ${result.publicId}`,
  );

  console.log(
    `Camera: ${metadata.camera ?? "Not found"}`,
  );

  console.log(
    `Lens: ${metadata.lens ?? "Not found"}`,
  );

  console.log(
    `Focal length: ${
      metadata.focalLength ??
      "Not found"
    }`,
  );

  console.log(
    `Aperture: ${
      metadata.aperture ??
      "Not found"
    }`,
  );

  console.log(
    `Shutter speed: ${
      metadata.shutterSpeed ??
      "Not found"
    }`,
  );

  console.log(
    `ISO: ${metadata.iso ?? "Not found"}`,
  );

  console.log(
    `Date taken: ${
      metadata.dateTaken ??
      metadata.rawDateTaken ??
      "Not found"
    }`,
  );

  console.log(
    `Populated fields: ${result.populatedFieldCount}`,
  );
}

async function analyseColourAssets(assets) {
  const successfulResults = [];
  const failedResults = [];

  for (
    let index = 0;
    index < assets.length;
    index += 1
  ) {
    const asset = assets[index];

    const filename =
      asset.display_name ??
      asset.public_id;

    console.log(
      `\n[${index + 1}/${assets.length}] ` +
        `Analysing colours for ` +
        `${filename}...`,
    );

    try {
      const result =
        await analyseAssetColours(asset);

      successfulResults.push(result);
      printColourResult(result);
    } catch (error) {
      failedResults.push({
        filename,
        publicId: asset.public_id,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });

      console.error(
        `Failed to analyse colours for ${filename}.`,
      );
    }
  }

  return {
    successfulResults,
    failedResults,
  };
}

async function analyseExifAssets(assets) {
  const successfulResults = [];
  const failedResults = [];

  for (
    let index = 0;
    index < assets.length;
    index += 1
  ) {
    const asset = assets[index];

    const filename =
      asset.display_name ??
      asset.public_id;

    console.log(
      `\n[${index + 1}/${assets.length}] ` +
        `Reading EXIF for ${filename}...`,
    );

    try {
      const result =
        await analyseAssetExif(asset);

      successfulResults.push(result);
      printExifResult(result);
    } catch (error) {
      failedResults.push({
        filename,
        publicId: asset.public_id,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });

      console.error(
        `Failed to read EXIF for ${filename}.`,
      );
    }
  }

  return {
    successfulResults,
    failedResults,
  };
}

function roundNumber(value) {
  return Number(value.toFixed(4));
}

function createColourDatabaseUpdate(
  result,
) {
  const dominant =
    result.dominantColour;

  return {
    dominant_colour_hex:
      dominant.hex,

    dominant_colour_hue:
      roundNumber(dominant.hue),

    dominant_colour_saturation:
      roundNumber(
        dominant.saturation,
      ),

    dominant_colour_lightness:
      roundNumber(
        dominant.lightness,
      ),

    colour_palette:
      result.palette.map(
        (colour) => colour.hex,
      ),
  };
}

async function writeColourResults(results) {
  const secretSupabase =
    createSecretSupabaseClient();

  const successfulWrites = [];
  const failedWrites = [];

  for (
    let index = 0;
    index < results.length;
    index += 1
  ) {
    const result = results[index];

    console.log(
      `[${index + 1}/${results.length}] ` +
        `Writing colours for ` +
        `${result.filename}...`,
    );

    try {
      const { data, error } =
        await secretSupabase
          .from("photos")
          .update(
            createColourDatabaseUpdate(
              result,
            ),
          )
          .eq(
            "cloudinary_public_id",
            result.publicId,
          )
          .select(
            "cloudinary_public_id",
          );

      if (error) {
        throw error;
      }

      if (
        !data ||
        data.length !== 1
      ) {
        throw new Error(
          `Expected one updated row but received ` +
            `${data?.length ?? 0}.`,
        );
      }

      successfulWrites.push(
        result.publicId,
      );
    } catch (error) {
      failedWrites.push({
        filename: result.filename,
        publicId: result.publicId,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });

      console.error(
        `Failed to write colours for ` +
          `${result.filename}.`,
      );
    }
  }

  return {
    successfulWrites,
    failedWrites,
  };
}

async function writeExifResults(results) {
  const secretSupabase =
    createSecretSupabaseClient();

  const successfulWrites = [];
  const failedWrites = [];

  for (
    let index = 0;
    index < results.length;
    index += 1
  ) {
    const result = results[index];

    console.log(
      `[${index + 1}/${results.length}] ` +
        `Writing EXIF for ` +
        `${result.filename}...`,
    );

    try {
      const databaseUpdate = {
        ...createExifDatabaseUpdate(
          result.metadata,
        ),
        exif_processed: true,
      };

      const { data, error } =
        await secretSupabase
          .from("photos")
          .update(databaseUpdate)
          .eq(
            "cloudinary_public_id",
            result.publicId,
          )
          .select(
            "cloudinary_public_id",
          );

      if (error) {
        throw error;
      }

      if (
        !data ||
        data.length !== 1
      ) {
        throw new Error(
          `Expected one updated row but received ` +
            `${data?.length ?? 0}.`,
        );
      }

      successfulWrites.push(
        result.publicId,
      );
    } catch (error) {
      failedWrites.push({
        filename: result.filename,
        publicId: result.publicId,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });

      console.error(
        `Failed to write EXIF for ` +
          `${result.filename}.`,
      );
    }
  }

  return {
    successfulWrites,
    failedWrites,
  };
}

async function runColourMode(
  assetsToAnalyse,
  writeColours,
) {
  const {
    successfulResults,
    failedResults,
  } = await analyseColourAssets(
    assetsToAnalyse,
  );

  console.log(
    "\nColour analysis summary:",
  );

  console.log(
    `Successful: ${successfulResults.length}`,
  );

  console.log(
    `Failed: ${failedResults.length}`,
  );

  if (failedResults.length > 0) {
    console.table(failedResults);
    process.exitCode = 1;
  }

  if (!writeColours) {
    console.log(
      "\nPreview complete. " +
        "No data was written to Supabase.",
    );

    return;
  }

  if (
    successfulResults.length === 0
  ) {
    console.log(
      "\nNo successful colour results were available to write.",
    );

    return;
  }

  console.log(
    "\nWriting colour data to Supabase...",
  );

  const {
    successfulWrites,
    failedWrites,
  } = await writeColourResults(
    successfulResults,
  );

  console.log(
    "\nSupabase colour write summary:",
  );

  console.log(
    `Successful: ${successfulWrites.length}`,
  );

  console.log(
    `Failed: ${failedWrites.length}`,
  );

  if (failedWrites.length > 0) {
    console.table(failedWrites);
    process.exitCode = 1;
  }

  console.log(
    "\nColour processing complete. " +
      "Gallery order was not changed.",
  );
}

async function runExifMode(
  assetsToAnalyse,
) {
  const {
    successfulResults,
    failedResults,
  } = await analyseExifAssets(
    assetsToAnalyse,
  );

  console.log(
    "\nEXIF analysis summary:",
  );

  console.log(
    `Successful: ${successfulResults.length}`,
  );

  console.log(
    `Failed: ${failedResults.length}`,
  );

  console.log(
    `With at least one EXIF field: ${
      successfulResults.filter(
        (result) =>
          result.populatedFieldCount > 0,
      ).length
    }`,
  );

  console.log(
    `Without relevant EXIF fields: ${
      successfulResults.filter(
        (result) =>
          result.populatedFieldCount === 0,
      ).length
    }`,
  );

  if (failedResults.length > 0) {
    console.table(failedResults);
    process.exitCode = 1;
  }

  if (
    successfulResults.length === 0
  ) {
    console.log(
      "\nNo successful EXIF results were available to write.",
    );

    return;
  }

  console.log(
    "\nWriting EXIF data to Supabase...",
  );

  const {
    successfulWrites,
    failedWrites,
  } = await writeExifResults(
    successfulResults,
  );

  console.log(
    "\nSupabase EXIF write summary:",
  );

  console.log(
    `Successful: ${successfulWrites.length}`,
  );

  console.log(
    `Failed: ${failedWrites.length}`,
  );

  if (failedWrites.length > 0) {
    console.table(failedWrites);
    process.exitCode = 1;
  }

  console.log(
    "\nEXIF processing complete. " +
      "Colour data and gallery order were not changed.",
  );
}

async function main() {
  const options = parseCommandOptions(
    process.argv.slice(2),
  );

  console.log(
    "Checking Cloudinary against Supabase...\n",
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

  const newAssets =
    findNewCloudinaryAssets(
      cloudinaryAssets,
      supabasePhotos,
    );

  const missingAssets =
    findMissingCloudinaryAssets(
      cloudinaryAssets,
      supabasePhotos,
    );

  const assetsNeedingColours =
    findAssetsNeedingColourProcessing(
      cloudinaryAssets,
      supabasePhotos,
      options.rewriteColours,
    );

  const assetsNeedingExif =
    findAssetsNeedingExifProcessing(
      cloudinaryAssets,
      supabasePhotos,
      options.rewriteExif,
    );

  console.log(
    `Cloudinary images: ${cloudinaryAssets.length}`,
  );

  console.log(
    `Supabase photo rows: ${supabasePhotos.length}`,
  );

  console.log(
    `New Cloudinary images: ${newAssets.length}`,
  );

  console.log(
    `Photos needing colour data: ` +
      `${assetsNeedingColours.length}`,
  );

  console.log(
    `Photos needing EXIF processing: ` +
      `${assetsNeedingExif.length}`,
  );

  console.log(
    `Supabase rows missing from Cloudinary: ` +
      `${missingAssets.length}`,
  );

  if (newAssets.length > 0) {
    console.log(
      "\nNew images not yet stored in Supabase:",
    );

    console.table(
      newAssets.map(
        createAssetSummary,
      ),
    );
  }

  if (missingAssets.length > 0) {
    console.log(
      "\nWarning: these Supabase records have " +
        "no matching Cloudinary image:",
    );

    console.table(
      missingAssets.map(
        (publicId) => ({
          publicId,
        }),
      ),
    );
  }

  if (options.writeExif) {
    if (options.rewriteExif) {
      console.log(
        "\nEXIF rewrite mode: all matching photos will be processed again.",
      );
    } else {
      console.log(
        "\nEXIF write mode: only photos not previously checked will be processed.",
      );
    }

    if (
      assetsNeedingExif.length === 0
    ) {
      console.log(
        "\nNo photos require EXIF processing.",
      );

      console.log(
        "No data was changed.",
      );

      return;
    }

    await runExifMode(
      assetsNeedingExif,
    );

    return;
  }

  let assetsToAnalyse = [];

  if (options.writeColours) {
    assetsToAnalyse =
      assetsNeedingColours;

    if (options.rewriteColours) {
      console.log(
        "\nColour rewrite mode: all matching photos will be analysed again.",
      );
    } else {
      console.log(
        "\nColour write mode: only photos with incomplete colour metadata will be analysed.",
      );
    }
  } else if (newAssets.length > 0) {
    assetsToAnalyse = newAssets;

    console.log(
      "\nNew images ready for colour preview:",
    );

    console.table(
      newAssets.map(
        createAssetSummary,
      ),
    );
  } else if (
    options.previewExistingLimit > 0
  ) {
    assetsToAnalyse =
      cloudinaryAssets.slice(
        0,
        options.previewExistingLimit,
      );

    console.log(
      `\nPreview mode: analysing ` +
        `${assetsToAnalyse.length} existing image(s).`,
    );
  } else {
    console.log(
      "\nNo processing mode selected.",
    );

    if (
      assetsNeedingColours.length > 0
    ) {
      console.log(
        `Run with --write-colours to process ` +
          `${assetsNeedingColours.length} photo(s).`,
      );
    }

    if (
      assetsNeedingExif.length > 0
    ) {
      console.log(
        `Run with --write-exif to process ` +
          `${assetsNeedingExif.length} photo(s).`,
      );
    }

    console.log(
      "Use --preview-existing=3 to run a read-only colour preview.",
    );

    console.log(
      "\nNo data was changed.",
    );

    return;
  }

  if (assetsToAnalyse.length === 0) {
    console.log(
      "\nNo photos require colour processing.",
    );

    console.log(
      "No data was changed.",
    );

    return;
  }

  await runColourMode(
    assetsToAnalyse,
    options.writeColours,
  );
}

main().catch((error) => {
  console.error(
    "\nPhoto processing failed.",
  );

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});