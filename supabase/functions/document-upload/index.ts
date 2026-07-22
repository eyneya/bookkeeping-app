import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const MAX_FILE_SIZE = 15 * 1024 * 1024;

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^\w.\-() ]/g, "_");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client with user's token for RLS-validated inserts
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service role client for storage operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const clientId = formData.get("client_id") as string;
    const customerId = formData.get("customer_id") as string;
    const docType = formData.get("doc_type") as string;
    const aiProvider = formData.get("ai_provider") as string || "claude";

    if (!file || !docType) {
      return new Response(JSON.stringify({ error: "file and doc_type are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!clientId && !customerId) {
      return new Response(JSON.stringify({ error: "Provide either client_id or customer_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (clientId && customerId) {
      return new Response(JSON.stringify({ error: "Provide only one of client_id or customer_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return new Response(JSON.stringify({ error: `Unsupported file type: ${file.type}. Only JPG, PNG, and PDF are accepted.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (file.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: "File too large (max 15MB)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeFilename = sanitizeFilename(file.name);
    const fileBuffer = new Uint8Array(await file.arrayBuffer());

    // Upload to Supabase Storage
    const storagePath = `${clientId || customerId}/${crypto.randomUUID()}-${safeFilename}`;
    const { error: uploadError } = await adminClient.storage
      .from("documents")
      .upload(storagePath, fileBuffer, { contentType: file.type });

    const storedPath = uploadError ? null : storagePath;

    // Insert document record (RLS-validated via userClient)
    const { data: docRecord, error: docError } = await userClient
      .from("documents")
      .insert({
        client_id: clientId || null,
        customer_id: customerId || null,
        doc_type: docType,
        original_filename: safeFilename,
        storage_path: storedPath,
        status: "pending",
      })
      .select()
      .single();

    if (docError) {
      return new Response(JSON.stringify({ error: docError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const documentId = docRecord.id;

    // Call AI extraction provider
    let extraction: any;
    try {
      const { data: extractionData, error: extractionError } = await adminClient.functions
        .invoke("ai-extract", {
          body: {
            file_buffer: Array.from(fileBuffer),
            mime_type: file.type,
            doc_type: docType,
            provider: aiProvider,
          },
        });

      if (extractionError) throw extractionError;
      extraction = extractionData;
    } catch (aiErr) {
      await userClient.from("documents").update({
        status: "error",
        error_message: aiErr.message,
      }).eq("id", documentId);

      return new Response(JSON.stringify({
        document_id: documentId,
        status: "error",
        error: aiErr.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update document with extraction results
    await userClient.from("documents").update({
      raw_extraction: extraction,
      status: "processed",
      processed_at: new Date().toISOString(),
    }).eq("id", documentId);

    let duplicateCount = 0;

    if (docType === "bank_statement") {
      // Reconciliation check
      const beginningBalance = extraction.beginning_balance;
      const endingBalance = extraction.ending_balance;
      const transactions = extraction.transactions || [];

      let reconStatus = "not_checked";
      let reconDiff = null;
      if (beginningBalance !== null && beginningBalance !== undefined && endingBalance !== null && endingBalance !== undefined) {
        const txnSum = transactions.reduce((s: number, t: any) => s + Number(t.amount), 0);
        const calculated = Number(beginningBalance) + txnSum;
        reconDiff = Math.round((calculated - Number(endingBalance)) * 100) / 100;
        reconStatus = Math.abs(reconDiff) < 0.01 ? "matched" : "mismatch";
      }

      await userClient.from("documents").update({
        statement_beginning_balance: beginningBalance ?? null,
        statement_ending_balance: endingBalance ?? null,
        reconciliation_status: reconStatus,
        reconciliation_diff: reconDiff,
      }).eq("id", documentId);

      // Insert extracted transactions with duplicate detection
      for (const txn of transactions) {
        // Check for possible duplicate
        let duplicateQuery = userClient
          .from("transactions")
          .select("id")
          .eq("txn_date", txn.date)
          .eq("amount", txn.amount)
          .ilike("description", txn.description)
          .limit(1);

        if (clientId) {
          duplicateQuery = duplicateQuery.eq("client_id", clientId);
        } else {
          duplicateQuery = duplicateQuery.eq("customer_id", customerId);
        }

        const { data: dupResult } = await duplicateQuery.maybeSingle();
        const duplicateOfId = dupResult?.id || null;
        const isDuplicate = !!duplicateOfId;
        if (isDuplicate) duplicateCount++;

        await userClient.from("transactions").insert({
          client_id: clientId || null,
          customer_id: customerId || null,
          document_id: documentId,
          txn_date: txn.date,
          description: txn.description,
          amount: txn.amount,
          needs_review: true,
          possible_duplicate: isDuplicate,
          duplicate_of_transaction_id: duplicateOfId,
        });
      }
    } else if (docType === "invoice") {
      const { data: txnRecord } = await userClient.from("transactions").insert({
        client_id: clientId || null,
        customer_id: customerId || null,
        document_id: documentId,
        txn_date: extraction.invoice_date,
        description: `Invoice ${extraction.invoice_number || ""} - ${extraction.vendor_name || "Unknown vendor"}`.trim(),
        amount: -Math.abs(extraction.amount || 0),
        needs_review: true,
      }).select().single();

      if (clientId && txnRecord) {
        await userClient.from("invoices").insert({
          client_id: clientId,
          document_id: documentId,
          transaction_id: txnRecord.id,
          vendor_name: extraction.vendor_name,
          invoice_number: extraction.invoice_number,
          invoice_date: extraction.invoice_date,
          due_date: extraction.due_date,
          amount: extraction.amount,
        });
      }
    }

    // Audit log
    await userClient.rpc("rpc_write_audit_log", {
      p_action: "document.upload",
      p_resource_type: clientId ? "client" : "customer",
      p_resource_id: clientId || customerId,
      p_metadata: { document_id: documentId, doc_type: docType, filename: safeFilename, duplicate_count: duplicateCount },
    });

    // Fetch the updated document
    const { data: finalDoc } = await userClient.from("documents").select("*").eq("id", documentId).single();

    return new Response(JSON.stringify({
      document_id: documentId,
      status: "processed",
      extraction,
      duplicate_count: duplicateCount,
      document: finalDoc,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
