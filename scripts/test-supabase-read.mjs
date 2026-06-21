import { createClient } from "@supabase/supabase-js";

function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const supabase = createClient(
  requireEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnvironmentVariable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

async function main() {
  console.log("Testing public Supabase access...");

  const { count, error } = await supabase
    .from("photos")
    .select("id", {
      count: "exact",
      head: true,
    });

  if (error) {
    throw error;
  }

  console.log("Supabase connection successful.");
  console.log(`Publicly readable photo rows: ${count ?? 0}`);
}

main().catch((error) => {
  console.error("\nSupabase connection test failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});