import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Groq from "groq-sdk";
import json5 from "json5"; // <--- ESTA LIBRERÍA ES LA QUE SALVA EL FORMATO

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const SYSTEM = `Eres un experto en prompt engineering.
Tu tarea es expandir el prompt del usuario en una instrucción MUY LARGA (mínimo 200 palabras), profesional y estructurada, sin perder la intención original.
El 'optimizedPrompt' debe ser un TEXTO. Usa **Negritas** para los títulos y \\n para saltos de línea.

REGLAS DE PUNTUACIÓN (OBLIGATORIO):
- Debes analizar el prompt y asignar un número entero del 0 al 100 a: objective, context, instructions, format, restrictions.
- El campo 'score' debe ser el PROMEDIO de la suma de los 5 valores anteriores.

EJEMPLO DE ESTRUCTURA DEL JSON FINAL (DEBES SEGUIR ESTE MOLDE):
{
  "optimizedPrompt": "Texto largo y optimizado...",
  "analysis": {
    "score": 85,
    "objective": 90,
    "context": 80,
    "instructions": 90,
    "format": 70,
    "restrictions": 90,
    "diagnosis": "Tu análisis aquí",
    "missingInformation": ["Dato 1", "Dato 2"]
  },
  "improvements": ["Mejora 1", "Mejora 2"]
}`;

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

    const ai = new Groq({ 
      apiKey: process.env.GROQ_API_KEY,
      timeout: 60000,
      maxRetries: 3
    });

    const response = await ai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userInput }
      ],
      temperature: 0.1,
    });

    let text = response.choices[0]?.message?.content || "";

    let cleanText = text.replace(/```json\s*/gi, "").replace(/```/gi, "").trim();
    const startIdx = cleanText.indexOf('{');
    const endIdx = cleanText.lastIndexOf('}');

    let jsonString = cleanText;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonString = cleanText.substring(startIdx, endIdx + 1);
    }

    let data;
    try {
      data = json5.parse(jsonString); 
    } catch (parseError) {
      console.error("Error al parsear JSON de Groq. Texto original:", text);
      return res.status(502).json({
        error: "Groq generó un formato de JSON incorrecto. Vuelve a intentarlo.",
      });
    }

    // 🛡️ SEGURO FINAL DE PUNTUACIÓN (Esto evita que salgan en 0)
    const metrics = ['objective', 'context', 'instructions', 'format', 'restrictions'];
    if (data.analysis) {
        let total = 0;
        metrics.forEach(m => {
            if (typeof data.analysis[m] !== 'number' || isNaN(data.analysis[m])) {
                data.analysis[m] = 0;
            }
            total += data.analysis[m];
        });
        // Si la IA se olvidó de poner el promedio, el código lo calcula solo
        if (typeof data.analysis.score !== 'number' || isNaN(data.analysis.score)) {
            data.analysis.score = Math.round(total / metrics.length);
        }
    }

    if (data.optimizedPrompt && typeof data.optimizedPrompt === 'object') {
        data.optimizedPrompt = JSON.stringify(data.optimizedPrompt, null, 2);
    }

    res.json(data);

  } catch (err) {
    console.error("Error en /api/optimize:", err);

    if (err.message && err.message.toLowerCase().includes('timeout')) {
      return res.status(500).json({
        error: "⏳ La conexión con Groq ha excedido el tiempo de espera. Comprueba tu conexión a Internet y vuelve a intentarlo.",
      });
    }

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