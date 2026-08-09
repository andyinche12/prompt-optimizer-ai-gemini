import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Groq from "groq-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
// Modelo recomendado: mixtral-8x7b-32768. Si no funciona, puedes cambiarlo a llama-3.3-70b-versatile
const MODEL = process.env.GROQ_MODEL || "mixtral-8x7b-32768";

// ==========================================
// INSTRUCCIÓN SISTEMA (Reforzada)
// ==========================================
const SYSTEM = 
    "Eres un experto en prompt engineering. " +
    "Expande el prompt del usuario en una instrucción MUY LARGA (mínimo 200 palabras), profesional, detallada y estructurada, sin perder la intención original. " +
    "IMPORTANTE: El campo 'optimizedPrompt' debe ser UN TEXTO LARGO (string), NO un objeto JSON. " +
    "NUNCA uses llaves `{}` dentro del contenido de optimizedPrompt para delimitar secciones. " +
    "Usa **Negritas** para los títulos de las secciones y saltos de línea `\\n` para separar párrafos. " +
    "REGLAS ESTRICTAS DE SALIDA: " +
    "1. DEVUELVE ÚNICAMENTE EL OBJETO JSON. NO añadas saludos ni explicaciones. " +
    "2. Sigue EXACTAMENTE este molde: " +
    "{ \"optimizedPrompt\": \"**Objetivo Principal:** texto... \\n**Contexto:** texto... \\n**Instrucciones:** pasos... \\n**Formato:** formato... \\n**Restricciones:** límites...\", " +
    "\"analysis\": { \"score\": 0, \"objective\": 0, \"context\": 0, \"instructions\": 0, \"format\": 0, \"restrictions\": 0, \"diagnosis\": \"diagnóstico\", \"missingInformation\": [\"Falta 1\", \"Falta 2\"] }, " +
    "\"improvements\": [\"Mejora 1\", \"Mejora 2\"] }";

const VALID_MODES = ["Auto", "Formal", "Creativo", "Técnico"];
const VALID_DETAILS = ["Resumido", "Equilibrado", "Detallado"];

app.post("/api/optimize", async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Falta GROQ_API_KEY en el archivo .env" });
    }

    const {
      prompt,
      mode = "Auto",
      detail = "Equilibrado",
      preserve = true,
      noInvent = true,
      detectMissing = true,
    } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Escribe un prompt primero." });
    }

    const finalMode = VALID_MODES.includes(mode) ? mode : "Auto";
    const finalDetail = VALID_DETAILS.includes(detail) ? detail : "Equilibrado";

    const userInput = `Modo: ${finalMode}
Nivel de detalle: ${finalDetail}
Mantener intención: ${preserve}
No inventar: ${noInvent}
Detectar faltantes: ${detectMissing}

PROMPT DEL USUARIO:
${prompt}`;

    const ai = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const response = await ai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userInput }
      ],
      temperature: 0.2, // Temperatura baja para que siga el molde al 100%
    });

    let text = response.choices[0]?.message?.content || "";

    // === BLOQUE ROBUSTO DE EXTRACCIÓN DE JSON ===
    let cleanText = text.replace(/```json\s*/gi, "").replace(/```/gi, "").trim();
    const startIdx = cleanText.indexOf('{');
    const endIdx = cleanText.lastIndexOf('}');

    let jsonString = cleanText;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonString = cleanText.substring(startIdx, endIdx + 1);
    }

    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("Error al parsear JSON de Groq. Texto original:", text);
      return res.status(502).json({
        error: "Groq tuvo problemas para generar el formato JSON. Vuelve a intentarlo.",
      });
    }
    // === FIN DEL BLOQUE ROBUSTO ===

    // 🛡️ ESCUDO DE SEGURIDAD: Si la IA se equivoca y mete un objeto dentro de optimizedPrompt, lo convierte a texto
    if (data.optimizedPrompt && typeof data.optimizedPrompt === 'object') {
        data.optimizedPrompt = JSON.stringify(data.optimizedPrompt, null, 2);
    }

    // Devolver la respuesta exitosa
    res.json(data);

  } catch (err) {
    console.error("Error en /api/optimize:", err);

    const isQuotaError = (err.status === 429) || 
                         (err.message && err.message.toLowerCase().includes('quota'));

    if (isQuotaError) {
      return res.status(429).json({
        error: "⚠️ Límite de peticiones de Groq excedido. Espera 1 minuto y vuelve a intentarlo."
      });
    }

    res.status(500).json({
      error: err?.message || "Error al consultar Groq.",
    });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`Prompt WERNER Optimizador IA (Groq): http://localhost:${PORT}`));