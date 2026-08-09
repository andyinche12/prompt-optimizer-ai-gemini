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
// Modelo recomendado gratuito y ultrarrápido en Groq
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const SYSTEM = `Eres Prompt Optimizer AI, un especialista profesional en prompt engineering.
Tu trabajo es transformar el prompt del usuario en una instrucción mucho más clara, precisa y útil SIN cambiar su intención.
Analiza objetivo, contexto, instrucciones, formato, restricciones y ambigüedades.
No inventes datos. Si falta información indispensable, indícala como faltante, pero no bloquees la optimización por datos secundarios.
Evita convertir una solicitud sencilla en una respuesta innecesariamente complicada.
Devuelve SIEMPRE JSON válido con exactamente estas claves:
{
 "optimizedPrompt": "prompt listo para copiar y pegar",
 "analysis": {
   "score": 0,
   "objective": 0,
   "context": 0,
   "instructions": 0,
   "format": 0,
   "restrictions": 0,
   "diagnosis": "explicación breve",
   "missingInformation": ["..."]
 },
 "improvements": ["..."]
}
Los valores de score y cada métrica deben ser números enteros de 0 a 100.
NO escribas absolutamente nada más que el JSON, ni saludos, ni explicaciones adicionales.`;

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
      temperature: 0.7,
    });

    let text = response.choices[0]?.message?.content || "";

    // === BLOQUE ROBUSTO DE EXTRACCIÓN DE JSON ===
    // 1. Limpiar bloques de código Markdown
    let cleanText = text.replace(/```json\s*/gi, "").replace(/```/gi, "").trim();

    // 2. Encontrar el primer '{' y el último '}' para aislar el JSON puro
    const startIdx = cleanText.indexOf('{');
    const endIdx = cleanText.lastIndexOf('}');

    let jsonString = cleanText;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        // Cortamos exactamente desde la primera llave hasta la última
        jsonString = cleanText.substring(startIdx, endIdx + 1);
    }

    // 3. Intentar parsear el JSON aislado
    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("Error al parsear JSON de Groq. Texto original:", text);
      console.error("Intento de parseo con aislación:", jsonString);
      return res.status(502).json({
        error: "Groq respondió en un formato no válido. Intenta nuevamente.",
      });
    }
    // === FIN DEL BLOQUE ROBUSTO ===

    res.json(data);

  } catch (err) {
    console.error("Error en /api/optimize:", err);

    // Capturar error de cuota excedida (Groq también usa código 429)
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