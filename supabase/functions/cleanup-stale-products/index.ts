import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const PRODUCT_IMAGES_BUCKET = "product-images";
const DEFAULT_STALE_DAYS = 60;
const CHUNK_SIZE = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function parseDays(url: URL) {
  const raw = url.searchParams.get("days");
  const parsed = raw ? Number(raw) : DEFAULT_STALE_DAYS;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_STALE_DAYS;
  return Math.round(parsed);
}

function isStoragePath(path: string) {
  return Boolean(path) && !/^https?:\/\//i.test(path) && !/^data:/i.test(path);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const functionSecret = Deno.env.get("CLEANUP_FUNCTION_SECRET");
  if (functionSecret) {
    const providedSecret = req.headers.get("x-cleanup-secret") ?? "";
    if (providedSecret !== functionSecret) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing Supabase environment variables" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const days = parseDays(new URL(req.url));
  const { data: candidates, error: candidatesError } = await supabase.rpc(
    "list_stale_out_of_stock_product_assets",
    { p_days: days },
  );

  if (candidatesError) {
    return json({ error: candidatesError.message }, 500);
  }

  const productIds = (candidates ?? []).map((item: { product_id: string }) => item.product_id);
  const storagePaths = [
    ...new Set(
      (candidates ?? [])
        .flatMap((item: { storage_paths: string[] | null }) => item.storage_paths ?? [])
        .filter(isStoragePath),
    ),
  ];

  for (const paths of chunk(storagePaths, CHUNK_SIZE)) {
    const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove(paths);
    if (error) {
      return json({ error: error.message }, 500);
    }
  }

  const { data: archivedCount, error: archiveError } = await supabase.rpc(
    "archive_stale_out_of_stock_products",
    { p_product_ids: productIds },
  );

  if (archiveError) {
    return json({ error: archiveError.message, deletedImages: storagePaths.length }, 500);
  }

  return json({
    ok: true,
    staleDays: days,
    archivedProducts: archivedCount ?? 0,
    deletedImages: storagePaths.length,
  });
});
