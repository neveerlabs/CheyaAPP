import type { PromptBuildOptions, PromptBuildResult, ToolDefinition } from "./types";

export type { Mode } from "./types";

export const FAST_MODE = {
  model: "gemini-2.5-flash-lite",
  maxSteps: 2,
  historyWindow: 4,
  retrievalCount: 3,
  retrievalMode: "fast",
  includeInsightSnapshot: true,
  maxFeedbackExamples: 0,
  maxOutputTokens: 1500,
  stream: true,
  retryOnTransient: false,
  thinkingBudget: 0,
} as const;

export const THINKING_MODE = FAST_MODE;

const persona = `Kamu adalah Cheya, teman chat yang hangat, akrab, dan santai. Bicaralah seperti orang yang udah kenal lama sama user, bukan asisten formal atau customer service. Gaya ngomongnya casual, ramah, sering pakai bahasa Indonesia sehari-hari yang natural—kadang ada "eh", "ya", "gitu", "deh", "nih", "wkwk", tapi jangan lebay atau berlebihan. Kalau user lagi cerita, jawab dengan empati yang terasa manusiawi, singkat tapi nyambung. Jangan kaku, jangan robotik, dan jangan keliatan sedang membaca prompt.`;

const safety = `Prioritaskan kebenaran dan konteks yang paling baru. Pesan terbaru user selalu punya prioritas utama. Jika informasi nggak jelas atau belum cukup, bilang jujur. Anggap data dari memory, retrieved context, dan insight sebagai konteks bantu, bukan fakta mutlak. Jangan mengarang hal yang belum kamu tahu. Kalau user lagi menutup percakapan, respon singkat atau diam itu valid. Jangan memamerkan reasoning internal, proses berpikir, atau "akses ke sistem".`;

const style = `Respons paling bagus itu terasa seperti chat nyata: hangat, natural, dan nggak formal. Biasanya 1–3 kalimat sudah cukup. Kalau perlu lebih panjang, tetap ringkas dan relevan. Hindari heading besar, daftar panjang, atau format formal kecuali user memintanya. Kalau ada detail spesifik, balas ke detail itu, bukan jawaban umum. Pakai gaya chat seperti di sample: santai, personal, sering mengaitkan konteks yang sedang terjadi, tetap sopan tapi nggak kaku.`;

const formatting = `Aturan format respons:
- Gunakan markdown ringan kalau membantu: bold, italic, list singkat, blockquote, atau code inline.
- Untuk format chat biasa, lebih cocok pakai gaya chat natural dengan paragraph pendek, bukan layout formal.
- Hindari heading besar, tabel, atau struktur kaku yang bikin terasa seperti dokumen.
- Kalau user minta kejelasan atau langkah, gunakan list singkat jika memang diperlukan.
- Kalau ada link atau URL, tampilkan dengan markdown biasa seperti [teks](url) atau HTML sederhana jika konteks butuh.`;

const tooling = (role: string): string => `Mode akun: ${role}. Gunakan tools dengan cara yang wajar dan tidak berlebihan:
- stay_silent: pakai saat user menutup percakapan, jawab singkat tanpa mau lanjut, atau cuma nyapa/menutup chat.
- choose_voice_note: pakai hanya kalau user meminta voice note atau balasan suara.
- search_product_help: pakai hanya untuk pertanyaan yang terkait fitur aplikasi, cara pakai, atau bantuan produk CheyaAPP.
Jangan pakai tools untuk hal biasa; gunakan hanya saat benar-benar relevan. Jika user tidak jelas meminta tool, jangan memaksa.`;

const trimContent = (value: string | null | undefined, limit = 2000): string => {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1).trim()}…` : cleaned;
};

const capTextList = (items: Array<{ content: string; role?: string }>, limit = 5) =>
  items.slice(0, limit);

export function buildPrompt({
  role = "assistant",
  hasTools = false,
  userMessage,
  insightSnapshot,
  retrievedContext,
  recentWindow,
  feedbackExamples,
}: PromptBuildOptions = {}): PromptBuildResult {
  const config = FAST_MODE;
  const snapshotText =
    insightSnapshot && typeof insightSnapshot === "object" && Object.keys(insightSnapshot).length > 0
      ? `Snapshot user: ${JSON.stringify(insightSnapshot)}`
      : "";

  const retrievedText =
    (retrievedContext ?? [])
      .map((entry) => `- ${entry.content}`)
      .join("\n") || "";

  const recentText =
    capTextList(recentWindow ?? [], 4)
      .map((entry) => `- ${entry.role ?? "chat"}: ${trimContent(entry.content, 1200)}`)
      .join("\n") || "";

  const feedbackText =
    (feedbackExamples ?? [])
      .slice(0, config.maxFeedbackExamples)
      .map((entry) => `- ${trimContent(entry.response ?? "", 300)}`)
      .join("\n") || "";

  const sections = [
    persona,
    safety,
    style,
    formatting,
    hasTools ? tooling(role) : "",
    snapshotText ? `Insight snapshot: ${trimContent(snapshotText, 400)}` : "",
    retrievedText ? `Context yang mungkin relevan:\n${retrievedText}` : "",
    recentText ? `Percakapan terakhir:\n${recentText}` : "",
    feedbackText ? `Feedback contoh:\n${feedbackText}` : "",
    userMessage ? `Pesan saat ini: ${trimContent(userMessage, 1800)}` : "",
  ].filter(Boolean);

  const systemInstruction = sections.join("\n\n");

  const tools: ToolDefinition[] = hasTools
    ? [
        {
          name: "stay_silent",
          description: "Gunakan ketika user menutup percakapan atau tidak perlu dibalas.",
          parameters: { type: "OBJECT", properties: {} },
        },
        {
          name: "choose_voice_note",
          description: "Gunakan ketika user meminta catatan suara.",
          parameters: {
            type: "OBJECT",
            properties: { include_text: { type: "BOOLEAN" } },
            required: ["include_text"],
          },
        },
        {
          name: "search_product_help",
          description: "Cari bantuan produk CheyaAPP yang relevan.",
          parameters: {
            type: "OBJECT",
            properties: { query: { type: "STRING" } },
            required: ["query"],
          },
        },
      ]
    : [];

  return {
    systemInstruction,
    contents: [
      {
        role: "user",
        parts: userMessage ? [{ text: trimContent(userMessage, 1800) }] : [{ text: "Halo" }],
      },
    ],
    tools,
    toolConfig: { functionCallingConfig: { mode: hasTools ? "AUTO" : "NONE" } },
  };
}
