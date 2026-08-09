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
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// ==========================================
// NUEVA INSTRUCCIÓN PARA RESPUESTAS LARGAS Y ESTRUCTURADAS
// ==========================================
const SYSTEM = `Eres Prompt Optimizer AI, un especialista profesional en prompt engineering.
Tu trabajo es transformar el prompt del usuario en una instrucción MUCHO MÁS LARGA, PROFUNDA y SUMAMENTE ESTRUCTURADA, sin cambiar su intención.

El 'optimizedPrompt' debe ser un texto extenso que ocupe múltiples párrafos y secciones claramente definidas. Usa el siguiente formato de secciones:
**Objetivo Principal:** [Define el propósito central de la tarea]
**Contexto y Audiencia:** [Describe el entorno o para quién va dirigido]
**Instrucciones Paso a Paso:** [Detalla una secuencia lógica de acciones que la IA debe seguir, incluyendo ejemplos concretos si aplica]
**Formato de Salida Esperado:** [Especifica exactamente cómo debe verse el resultado final: lista, tabla, párrafo, código, etc.]
**Restricciones y Limitaciones:** [Indica qué debe evitar la IA, límite de palabras, tono, o formato no permitido]

Analiza el prompt en busca de ambigüedades. No inventes datos. Si falta información indispensable, indícala dentro del mismo 'optimizedPrompt' o en el campo 'missingInformation' de la respuesta JSON.

Devuelve SIEMPRE JSON válido con exactamente estas claves:
{
 "optimizedPrompt": "prompt largo y estructurado listo para copiar y pegar",
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
Los valores de score y cada métrica deben ser números enteros de 0 a 100.`;

// ==========================================

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
      temperature: 0.5, // Bajado a 0.5 para que sea más estricto y estructurado
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
        error: "Groq respondió en un formato no válido. Intenta nuevamente.",
      });
    }
    // === FIN DEL BLOQUE ROBUSTO ===

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