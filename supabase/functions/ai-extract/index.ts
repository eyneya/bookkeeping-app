import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
    const { file_buffer, mime_type, doc_type, provider } = await req.json();

    if (!file_buffer || !mime_type || !doc_type) {
      return new Response(JSON.stringify({ error: "file_buffer, mime_type, and doc_type are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uint8 = new Uint8Array(file_buffer);
    const base64 = btoa(String.fromCharCode(...uint8));
    const dataUrl = `data:${mime_type};base64,${base64}`;

    let extraction: any;

    if (provider === "openai") {
      extraction = await extractWithOpenAI(dataUrl, mime_type, doc_type);
    } else {
      extraction = await extractWithClaude(dataUrl, mime_type, doc_type);
    }

    return new Response(JSON.stringify(extraction), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function extractWithClaude(dataUrl: string, mimeType: string, docType: string): Promise<any> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const prompt = docType === "bank_statement"
    ? `Extract all transactions from this bank statement. Return JSON with this exact structure:
       { "transactions": [{ "date": "YYYY-MM-DD", "description": "string", "amount": number }],
         "beginning_balance": number | null, "ending_balance": number | null }
       Amounts: positive for deposits/credits, negative for withdrawals/debits.`
    : `Extract the invoice details. Return JSON with this exact structure:
       { "invoice_number": string | null, "vendor_name": string | null,
         "invoice_date": "YYYY-MM-DD" | null, "due_date": "YYYY-MM-DD" | null,
         "amount": number | null }`;

  const mediaType = mimeType === "application/pdf" ? "application/pdf" : mimeType.split("/")[1];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: dataUrl.split(",")[1] },
            },
            { type: "text", text: prompt + " Return ONLY the JSON, no other text." },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "{}";
  return JSON.parse(text.replace(/```json\n?/g, "").replace(/```/g, "").trim());
}

async function extractWithOpenAI(dataUrl: string, mimeType: string, docType: string): Promise<any> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  if (mimeType === "application/pdf") {
    throw new Error("OpenAI vision API does not support PDF. Use Claude for PDFs.");
  }

  const prompt = docType === "bank_statement"
    ? `Extract all transactions from this bank statement. Return JSON with this exact structure:
       { "transactions": [{ "date": "YYYY-MM-DD", "description": "string", "amount": number }],
         "beginning_balance": number | null, "ending_balance": number | null }
       Amounts: positive for deposits/credits, negative for withdrawals/debits.`
    : `Extract the invoice details. Return JSON with this exact structure:
       { "invoice_number": string | null, "vendor_name": string | null,
         "invoice_date": "YYYY-MM-DD" | null, "due_date": "YYYY-MM-DD" | null,
         "amount": number | null }`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt + " Return ONLY the JSON, no other text." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(text.replace(/```json\n?/g, "").replace(/```/g, "").trim());
}
