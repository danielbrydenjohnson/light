import Anthropic from "@anthropic-ai/sdk";

export const AI_TAG_MODEL = "claude-sonnet-4-6";

const ALLOWED_TIMES_OF_DAY = new Set([
  "golden_hour",
  "blue_hour",
  "night",
  "midday",
  "overcast",
  "dawn",
  "dusk",
  "ambiguous",
]);

const ALLOWED_SEASONS = new Set([
  "spring",
  "summer",
  "autumn",
  "winter",
  "ambiguous",
]);

const ALLOWED_WEATHER = new Set([
  "clear",
  "cloudy",
  "overcast",
  "rainy",
  "foggy",
  "stormy",
  "snowy",
  "ambiguous",
]);

const TAG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    mood: {
      type: "string",
      description:
        "One concise lower-case adjective describing the dominant emotional mood.",
    },
    time_of_day: {
      type: "string",
      enum: [
        "golden_hour",
        "blue_hour",
        "night",
        "midday",
        "overcast",
        "dawn",
        "dusk",
        "ambiguous",
      ],
    },
    subjects: {
      type: "array",
      items: {
        type: "string",
      },
      description:
        "One to five concise lower-case noun phrases describing visible subjects.",
    },
    season: {
      type: "string",
      enum: [
        "spring",
        "summer",
        "autumn",
        "winter",
        "ambiguous",
      ],
    },
    weather: {
      type: "string",
      enum: [
        "clear",
        "cloudy",
        "overcast",
        "rainy",
        "foggy",
        "stormy",
        "snowy",
        "ambiguous",
      ],
    },
  },
  required: [
    "mood",
    "time_of_day",
    "subjects",
    "season",
    "weather",
  ],
};

const TAGGING_PROMPT = `
Analyse this photograph for a photography portfolio.

Return metadata based only on what is visibly supported by the photograph.

Rules:
1. mood must be one concise lower-case adjective.
2. Choose the most specific useful mood. Do not default to "vibrant" merely because the photograph is colourful or highly saturated.
3. subjects must contain between one and five concise lower-case noun phrases describing visible subjects.
4. Use ambiguous for season unless there is strong direct visual evidence such as snow, autumn foliage, blossom, or clearly seasonal vegetation.
5. Use ambiguous for weather unless atmospheric conditions or the sky are clearly visible.
6. Use ambiguous for time of day when lighting alone does not reliably distinguish dawn, dusk, blue hour, night, or midday.
7. Do not infer a location, event, identity, camera setting, date, or backstory.
8. Describe the photograph itself, not its editing style.
`.trim();

function normaliseShortText(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function validateTags(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      "Claude returned an invalid tag object.",
    );
  }

  const {
    mood,
    time_of_day: timeOfDay,
    subjects,
    season,
    weather,
  } = value;

  if (
    typeof mood !== "string" ||
    normaliseShortText(mood).length === 0
  ) {
    throw new Error(
      "Claude returned an invalid mood.",
    );
  }

  if (!ALLOWED_TIMES_OF_DAY.has(timeOfDay)) {
    throw new Error(
      `Claude returned an invalid time_of_day: ${timeOfDay}`,
    );
  }

  if (
    !Array.isArray(subjects) ||
    subjects.length < 1 ||
    subjects.length > 5 ||
    subjects.some(
      (subject) =>
        typeof subject !== "string" ||
        normaliseShortText(subject).length === 0,
    )
  ) {
    throw new Error(
      "Claude must return between one and five valid subjects.",
    );
  }

  if (!ALLOWED_SEASONS.has(season)) {
    throw new Error(
      `Claude returned an invalid season: ${season}`,
    );
  }

  if (!ALLOWED_WEATHER.has(weather)) {
    throw new Error(
      `Claude returned invalid weather: ${weather}`,
    );
  }

  return {
    mood: normaliseShortText(mood),
    timeOfDay,
    subjects: subjects.map(normaliseShortText),
    season,
    weather,
  };
}

function getTextResponse(message) {
  const textBlock = message.content.find(
    (block) => block.type === "text",
  );

  if (!textBlock) {
    throw new Error(
      "Claude returned no text response.",
    );
  }

  return textBlock.text;
}

export function createAiTagClient(apiKey) {
  if (!apiKey) {
    throw new Error(
      "An Anthropic API key is required.",
    );
  }

  return new Anthropic({
    apiKey,
  });
}

export async function analysePhotoTags({
  client,
  imageUrl,
  filename,
}) {
  if (!client) {
    throw new Error(
      "An Anthropic client is required.",
    );
  }

  if (!imageUrl) {
    throw new Error(
      "An image URL is required.",
    );
  }

  const message = await client.messages.create({
    model: AI_TAG_MODEL,
    max_tokens: 400,
    temperature: 0,
    output_config: {
      format: {
        type: "json_schema",
        schema: TAG_SCHEMA,
      },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "url",
              url: imageUrl,
            },
          },
          {
            type: "text",
            text: TAGGING_PROMPT,
          },
        ],
      },
    ],
  });

  if (message.stop_reason === "refusal") {
    throw new Error(
      `Claude refused to analyse ${filename ?? "the photograph"}.`,
    );
  }

  if (message.stop_reason === "max_tokens") {
    throw new Error(
      `Claude reached the token limit while analysing ${
        filename ?? "the photograph"
      }.`,
    );
  }

  const responseText = getTextResponse(message);
  const parsedTags = JSON.parse(responseText);
  const tags = validateTags(parsedTags);

  return {
    tags,
    model: AI_TAG_MODEL,
    stopReason: message.stop_reason,
    usage: message.usage,
  };
}

export function createAiTagDatabaseUpdate(tags) {
  return {
    mood: tags.mood,
    time_of_day: tags.timeOfDay,
    subjects: tags.subjects,
    season: tags.season,
    weather: tags.weather,
    ai_processed: true,
  };
}