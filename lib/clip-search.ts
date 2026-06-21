const EMBEDDING_MODEL_ID =
  "Xenova/clip-vit-base-patch32";

const EMBEDDING_DIMENSIONS = 512;
const CLIP_MAX_TOKEN_LENGTH = 77;

type ClipTokenizerInputs =
  Record<string, unknown>;

type ClipTokenizer = (
  text: string,
  options: {
    padding: boolean;
    truncation: boolean;
    max_length: number;
  },
) => Promise<ClipTokenizerInputs>;

type ClipTextModelOutput = {
  text_embeds?: {
    data: ArrayLike<number>;
  };
};

type ClipTextModel = (
  inputs: ClipTokenizerInputs,
) => Promise<ClipTextModelOutput>;

type ClipTextPipeline = {
  tokenizer: ClipTokenizer;
  model: ClipTextModel;
};

let pipelinePromise:
  Promise<ClipTextPipeline> | null = null;

function calculateMagnitude(
  vector: number[],
): number {
  const squaredSum = vector.reduce(
    (sum, value) =>
      sum + value * value,
    0,
  );

  return Math.sqrt(squaredSum);
}

function validateEmbedding(
  embedding: number[],
): void {
  if (
    embedding.length !==
    EMBEDDING_DIMENSIONS
  ) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSIONS} embedding values but received ${embedding.length}.`,
    );
  }

  if (
    embedding.some(
      (value) =>
        !Number.isFinite(value),
    )
  ) {
    throw new Error(
      "CLIP returned a non-finite embedding value.",
    );
  }
}

function normaliseEmbedding(
  embedding: number[],
): number[] {
  const magnitude =
    calculateMagnitude(embedding);

  if (
    !Number.isFinite(magnitude) ||
    magnitude === 0
  ) {
    throw new Error(
      "CLIP returned an embedding with an invalid magnitude.",
    );
  }

  return embedding.map(
    (value) => value / magnitude,
  );
}

async function loadClipTextPipeline():
  Promise<ClipTextPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (
      async () => {
        const {
          AutoTokenizer,
          CLIPTextModelWithProjection,
          env,
        } = await import(
          "@huggingface/transformers"
        );

        env.allowLocalModels = false;

        const [
          tokenizer,
          model,
        ] = await Promise.all([
          AutoTokenizer.from_pretrained(
            EMBEDDING_MODEL_ID,
          ),

          CLIPTextModelWithProjection.from_pretrained(
            EMBEDDING_MODEL_ID,
            {
              dtype: "q8",
            },
          ),
        ]);

        return {
          tokenizer:
            tokenizer as unknown as ClipTokenizer,

          model:
            model as unknown as ClipTextModel,
        };
      }
    )().catch((error) => {
      pipelinePromise = null;
      throw error;
    });
  }

  return pipelinePromise;
}

export async function prepareClipTextSearch():
  Promise<void> {
  await loadClipTextPipeline();
}

export async function createTextEmbedding(
  query: string,
): Promise<number[]> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    throw new Error(
      "A search query is required.",
    );
  }

  const {
    tokenizer,
    model,
  } = await loadClipTextPipeline();

  const inputs = await tokenizer(
    trimmedQuery,
    {
      padding: true,
      truncation: true,
      max_length:
        CLIP_MAX_TOKEN_LENGTH,
    },
  );

  const output = await model(inputs);

  if (!output.text_embeds) {
    throw new Error(
      "CLIP returned no projected text embedding.",
    );
  }

  const rawEmbedding = Array.from(
    output.text_embeds.data,
    (value) => Number(value),
  );

  validateEmbedding(rawEmbedding);

  const embedding =
    normaliseEmbedding(rawEmbedding);

  validateEmbedding(embedding);

  return embedding;
}

export function calculateEmbeddingSimilarity(
  firstEmbedding: number[],
  secondEmbedding: number[],
): number {
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