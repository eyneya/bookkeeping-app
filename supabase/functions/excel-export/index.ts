import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const clientId = url.searchParams.get("client_id");
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");

    if (!clientId) {
      return new Response(JSON.stringify({ error: "client_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all report data via RPCs
    const [plData, balanceSheetData, glData] = await Promise.all([
      userClient.rpc("rpc_pl_report", { p_client_id: clientId, p_start_date: startDate, p_end_date: endDate }),
      userClient.rpc("rpc_balance_sheet_report", { p_client_id: clientId, p_as_of_date: endDate }),
      userClient.rpc("rpc_general_ledger", { p_client_id: clientId, p_start_date: startDate, p_end_date: endDate }),
    ]);

    // Fetch transactions for the Transactions tab
    const { data: transactions } = await userClient
      .from("transactions")
      .select("txn_date, description, amount, is_business, needs_review, notes, accounts(name)")
      .eq("client_id", clientId)
      .order("txn_date", { ascending: true });

    // Fetch client info
    const { data: client } = await userClient.from("clients").select("*").eq("id", clientId).single();

    // Build CSV (lightweight alternative to ExcelJS in edge runtime)
    const csvParts: string[] = [];

    // Transactions sheet
    csvParts.push("=== Transactions ===");
    csvParts.push("Date,Description,Amount,Account,Business?,Needs Review,Notes");
    (transactions || []).forEach((t: any) => {
      csvParts.push([
        t.txn_date,
        escapeCsv(t.description),
        Number(t.amount).toFixed(2),
        t.accounts?.name || "",
        t.is_business === null ? "" : t.is_business ? "Business" : "Personal",
        t.needs_review ? "Yes" : "",
        escapeCsv(t.notes || ""),
      ].join(","));
    });

    // P&L sheet
    csvParts.push("\n=== P&L ===");
    csvParts.push("Category,Amount");
    if (Array.isArray(plData)) {
      plData.forEach((r: any) => {
        csvParts.push(`${escapeCsv(r.account_name)},${Number(r.total).toFixed(2)}`);
      });
    }

    // Balance Sheet sheet
    csvParts.push("\n=== Balance Sheet ===");
    csvParts.push("Category,Amount");
    if (Array.isArray(balanceSheetData)) {
      balanceSheetData.forEach((r: any) => {
        csvParts.push(`${escapeCsv(r.account_name)},${Number(r.total).toFixed(2)}`);
      });
    }

    // General Ledger sheet
    csvParts.push("\n=== General Ledger ===");
    csvParts.push("Date,Description,Account,Business?,Amount");
    if (Array.isArray(glData)) {
      glData.forEach((r: any) => {
        csvParts.push([
          r.txn_date,
          escapeCsv(r.description),
          r.account_name || "",
          r.is_business === null ? "" : r.is_business ? "Business" : "Personal",
          Number(r.amount).toFixed(2),
        ].join(","));
      });
    }

    const csv = csvParts.join("\n");
    const filename = `${(client?.name || "export").replace(/[^a-z0-9]+/gi, "_")}-bookkeeping.csv`;

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function escapeCsv(value: string): string {
  if (!value) return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
