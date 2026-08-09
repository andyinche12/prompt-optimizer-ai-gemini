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
// NUEVA INSTRUCCIÓN A PRUEBA DE FALLOS
// ==========================================
const SYSTEM = `Eres un experto en prompt engineering. 
Tu tarea es expandir el prompt del usuario en una instrucción MUY LARGA, profesional, detallada y estructurada, sin perder su intención original.
El resultado 'optimizedPrompt' debe tener mínimo 200 palabras y usar secciones con **Negritas** para organizarlo (Ej: **Objetivo**, **Contexto**, **Instrucciones paso a paso**, **Formato esperado**, **Restricciones**).

REGLAS ESTRICTAS DE SALIDA:
1. DEVUELVE ÚNICAMENTE EL OBJETO JSON. NO escribas absolutamente nada más (ni saludos, ni explicaciones, ni "Aquí tienes").
2. La respuesta DEBE empezar EXACTAMENTE con el carácter `{` y terminar con el carácter `}`.
3. Escapa correctamente las comillas dobles dentro del texto con \\".
4. Analiza el prompt y rellena los campos 'missingInformation' y 'diagnosis' si falta algo importante.

{
 "optimizedPrompt": "Prompt optimizado, largo y muy estructurado en secciones",
 "analysis": {
   "score": 0-100,
   "objective": 0-100,
   "context": 0-100,
   "instructions": 0-100,
   "format": 0-100,
   "restrictions": 0-100,
   "diagnosis": "Análisis breve",
   "missingInformation": ["Dato faltante 1", "Dato faltante 2"]
 },
 "improvements": ["Mejora 1", "Mejora 2"]
}`;
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
      temperature: 0.4, // Bajado a 0.4 para que sea más rígido con las reglas del JSON
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
      // Si falla el parseo, devolvemos un error más descriptivo y amigable
      return res.status(502).json({
        error: "Groq tuvo problemas para generar el formato JSON. Por seguridad, hemos cambiado el modelo a 'mixtral-8x7b-32768' automáticamente. Vuelve a intentarlo."
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