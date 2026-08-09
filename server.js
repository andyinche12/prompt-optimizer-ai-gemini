import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Groq from "groq-sdk";
import json5 from "json5"; // <--- NUEVA LIBRERÍA AÑADIDA

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const SYSTEM = `Eres un experto en prompt engineering.
Tu tarea es expandir el prompt del usuario en una instrucción MUY LARGA (mínimo 200 palabras), profesional, detallada y estructurada, sin perder la intención original.
El campo 'optimizedPrompt' debe ser UN TEXTO LARGO (string).
NUNCA uses llaves {} dentro del contenido de optimizedPrompt. Usa **Negritas** para los títulos de las secciones y \\n para saltos de línea.
REGLAS ESTRICTAS DE SALIDA:
1. DEVUELVE ÚNICAMENTE EL OBJETO JSON. NO añadas saludos ni explicaciones.
2. Sigue EXACTAMENTE este molde:
{ "optimizedPrompt": "**Objetivo Principal:** texto... \\n**Contexto:** texto... \\n**Instrucciones:** pasos... \\n**Formato:** formato... \\n**Restricciones:** límites...", "analysis": { "score": 0, "objective": 0, "context": 0, "instructions": 0, "format": 0, "restrictions": 0, "diagnosis": "diagnóstico", "missingInformation": ["Falta 1", "Falta 2"] }, "improvements": ["Mejora 1", "Mejora 2"] }`;

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

    // === BLOQUE DE EXTRACCIÓN DE JSON (AHORA CON JSON5) ===
    let cleanText = text.replace(/```json\s*/gi, "").replace(/```/gi, "").trim();
    const startIdx = cleanText.indexOf('{');
    const endIdx = cleanText.lastIndexOf('}');

    let jsonString = cleanText;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonString = cleanText.substring(startIdx, endIdx + 1);
    }

    let data;
    try {
      // Intento estándar
      data = JSON.parse(jsonString);
    } catch (parseError) {
      console.warn("JSON estándar falló. Intentando reparar con JSON5...");
      try {
        // Usamos JSON5, que es tolerante a saltos de línea literales y comillas sueltas
        data = json5.parse(jsonString);
        console.log("JSON reparado exitosamente con JSON5.");
      } catch (json5Error) {
        console.error("Error al parsear JSON de Groq incluso con JSON5. Texto original:", text);
        return res.status(502).json({
          error: "Groq generó un formato de JSON incorrecto. Vuelve a intentarlo.",
        });
      }
    }
    // === FIN DEL BLOQUE ===

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