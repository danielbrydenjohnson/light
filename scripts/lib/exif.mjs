import ExifReader from "exifreader";

function cleanValue(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function getTagValue(tags, possibleNames) {
  for (const name of possibleNames) {
    const tag = tags[name];

    if (!tag) {
      continue;
    }

    const description = cleanValue(tag.description);

    if (description) {
      return description;
    }

    if (Array.isArray(tag.value)) {
      const arrayValue = cleanValue(
        tag.value.join(", "),
      );

      if (arrayValue) {
        return arrayValue;
      }
    }

    const value = cleanValue(tag.value);

    if (value) {
      return value;
    }
  }

  return null;
}

function createCameraName(make, model) {
  if (!make) {
    return model;
  }

  if (!model) {
    return make;
  }

  const normalisedMake = make.toLowerCase();
  const normalisedModel = model.toLowerCase();

  if (normalisedModel.startsWith(normalisedMake)) {
    return model;
  }

  const firstMakeWord = normalisedMake.split(" ")[0];

  if (normalisedModel.startsWith(firstMakeWord)) {
    return model;
  }

  return `${make} ${model}`;
}

function removeTrailingDecimalZero(value) {
  return value.replace(/^(\d+)\.0$/, "$1");
}

function formatAperture(value) {
  if (!value) {
    return null;
  }

  const cleanedValue = value
    .replace(/^f\//i, "")
    .trim();

  return `f/${removeTrailingDecimalZero(cleanedValue)}`;
}

function formatIso(value) {
  if (!value) {
    return null;
  }

  if (value.toLowerCase().startsWith("iso")) {
    return value;
  }

  return `ISO ${value}`;
}

function formatShutterSpeed(value) {
  if (!value) {
    return null;
  }

  const cleanedValue = value.trim();
  const lowerValue = cleanedValue.toLowerCase();

  if (
    lowerValue.endsWith("s") ||
    lowerValue.includes("second") ||
    lowerValue.includes("sec")
  ) {
    return cleanedValue;
  }

  if (/^\d+(\.\d+)?$/.test(cleanedValue)) {
    return `${cleanedValue}s`;
  }

  if (/^\d+\s*\/\s*\d+$/.test(cleanedValue)) {
    return `${cleanedValue.replace(/\s/g, "")}s`;
  }

  return cleanedValue;
}

function normaliseExifDate(value) {
  if (!value) {
    return null;
  }

  const match = value.match(
    /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
  );

  if (!match) {
    return null;
  }

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
  ] = match;

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export function extractExifMetadata(imageBuffer) {
  const tags = ExifReader.load(imageBuffer);

  const make = getTagValue(tags, [
    "Make",
    "CameraManufacturer",
  ]);

  const model = getTagValue(tags, [
    "Model",
    "CameraModelName",
  ]);

  const rawDateTaken = getTagValue(tags, [
    "DateTimeOriginal",
    "CreateDate",
    "DateTimeDigitized",
    "DateTime",
  ]);

  return {
    camera: createCameraName(make, model),

    lens: getTagValue(tags, [
      "LensModel",
      "Lens",
      "LensInfo",
      "LensSpecification",
    ]),

    focalLength: getTagValue(tags, [
      "FocalLength",
      "FocalLengthIn35mmFilm",
    ]),

    aperture: formatAperture(
      getTagValue(tags, [
        "FNumber",
        "ApertureValue",
      ]),
    ),

    shutterSpeed: formatShutterSpeed(
      getTagValue(tags, [
        "ExposureTime",
        "ShutterSpeedValue",
      ]),
    ),

    iso: formatIso(
      getTagValue(tags, [
        "PhotographicSensitivity",
        "ISOSpeedRatings",
        "ISO",
      ]),
    ),

    dateTaken: normaliseExifDate(rawDateTaken),

    rawDateTaken,
  };
}

export function countPopulatedExifFields(metadata) {
  return [
    metadata.camera,
    metadata.lens,
    metadata.focalLength,
    metadata.aperture,
    metadata.shutterSpeed,
    metadata.iso,
    metadata.dateTaken,
  ].filter(Boolean).length;
}

export function createExifDatabaseUpdate(metadata) {
  return {
    exif_camera: metadata.camera,
    exif_lens: metadata.lens,
    exif_focal_length: metadata.focalLength,
    exif_aperture: metadata.aperture,
    exif_shutter_speed: metadata.shutterSpeed,
    exif_iso: metadata.iso,
    date_taken: metadata.dateTaken,
  };
}
