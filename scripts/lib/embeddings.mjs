import {
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
} from "@huggingface/transformers";

export const EMBEDDING_MODEL_ID =
  "Xenova/clip-vit-base-patch32";

export const EMBEDDING_DIMENSIONS = 512;

let modelPromise = null;
let processorPromise = null;

function calculateMagnitude(vector) {
  const squaredSum = vector.reduce(
    (sum, value) => sum + value * value,
    0,
  );

  return Math.sqrt(squaredSum);
}

function normaliseVector(vector) {
  const magnitude =
    calculateMagnitude(vector);

  if (
    !Number.isFinite(magnitude) ||
    magnitude === 0
  ) {
    throw new Error(
      "CLIP returned an embedding with an invalid magnitude.",
    );
  }

  return vector.map(
    (value) => value / magnitude,
  );
}

export function validateEmbedding(vector) {
  if (!Array.isArray(vector)) {
    throw new Error(
      "CLIP did not return an embedding array.",
    );
  }

  if (
    vector.length !==
    EMBEDDING_DIMENSIONS
  ) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSIONS} embedding values but received ${vector.length}.`,
    );
  }

  if (
    vector.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value),
    )
  ) {
    throw new Error(
      "CLIP returned a non-numeric or non-finite embedding value.",
    );
  }
}

export function getEmbeddingMagnitude(vector) {
  validateEmbedding(vector);

  return calculateMagnitude(vector);
}

export async function loadEmbeddingProcessor() {
  if (!processorPromise) {
    processorPromise =
      AutoProcessor.from_pretrained(
        EMBEDDING_MODEL_ID,
      );
  }

  return processorPromise;
}

export async function loadEmbeddingModel() {
  if (!modelPromise) {
    modelPromise =
      CLIPVisionModelWithProjection.from_pretrained(
        EMBEDDING_MODEL_ID,
        {
          dtype: "q8",
        },
      );
  }

  return modelPromise;
}

export async function loadEmbeddingPipeline() {
  const [processor, model] =
    await Promise.all([
      loadEmbeddingProcessor(),
      loadEmbeddingModel(),
    ]);

  return {
    processor,
    model,
  };
}

export async function createImageEmbedding({
  processor,
  model,
  imageUrl,
}) {
  if (!processor) {
    throw new Error(
      "A CLIP image processor is required.",
    );
  }

  if (!model) {
    throw new Error(
      "A CLIP vision model is required.",
    );
  }

  if (!imageUrl) {
    throw new Error(
      "An image URL is required.",
    );
  }

  const image =
    await RawImage.fromURL(imageUrl);

  const inputs =
    await processor(image);

  const output =
    await model(inputs);

  if (!output.image_embeds) {
    throw new Error(
      "CLIP returned no projected image embedding.",
    );
  }

  const rawEmbedding = Array.from(
    output.image_embeds.data,
  );

  validateEmbedding(rawEmbedding);

  const embedding =
    normaliseVector(rawEmbedding);

  validateEmbedding(embedding);

  return {
    embedding,
    rawMagnitude:
      calculateMagnitude(rawEmbedding),
    normalisedMagnitude:
      calculateMagnitude(embedding),
    tensorDimensions:
      output.image_embeds.dims,
    tensorType:
      output.image_embeds.type,
  };
}

export function createEmbeddingDatabaseUpdate(
  embedding,
) {
  validateEmbedding(embedding);

  return {
    embedding,
    embedding_processed: true,
  };
}

export function calculateCosineSimilarity(
  firstEmbedding,
  secondEmbedding,
) {
  validateEmbedding(firstEmbedding);
  validateEmbedding(secondEmbedding);

  let dotProduct = 0;

  for (
    let index = 0;
    index < EMBEDDING_DIMENSIONS;
    index += 1
  ) {
    dotProduct +=
      firstEmbedding[index] *
      secondEmbedding[index];
  }

  return dotProduct;
}