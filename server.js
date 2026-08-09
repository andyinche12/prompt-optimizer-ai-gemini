import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

// Instrucción del sistema (sin cambios)
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
Los valores de score y cada métrica deben ser números enteros de 0 a 100.`;

// Validación de modos y niveles de detalle (para evitar entradas no deseadas)
const VALID_MODES = ["Auto", "Formal", "Creativo", "Técnico"];
const VALID_DETAILS = ["Resumido", "Equilibrado", "Detallado"];

app.post("/api/optimize", async (req, res) => {
  try {
    // Validar API Key
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Falta GEMINI_API_KEY en el archivo .env" });
    }

    // Extraer y validar parámetros
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

    // Sanitizar valores (si no son válidos, usar defaults)
    const finalMode = VALID_MODES.includes(mode) ? mode : "Auto";
    const finalDetail = VALID_DETAILS.includes(detail) ? detail : "Equilibrado";

    // Construir el mensaje del usuario
    const userInput = `Modo: ${finalMode}
Nivel de detalle: ${finalDetail}
Mantener intención: ${preserve}
No inventar: ${noInvent}
Detectar faltantes: ${detectMissing}

PROMPT DEL USUARIO:
${prompt}`;

    // Inicializar el cliente de Gemini
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Usamos el método más estable: generateContent
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: userInput }] }],
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.7, // Control de creatividad (0 = más exacto, 1 = más creativo)
      },
    });

    // Obtener el texto de respuesta (el método .text es el más estándar en el SDK)
   ("Tipo de response.text:", typeof response.text, response.text);
let text = response.text || "";
    // Limpiar posibles marcadores de código Markdown
    text = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

    // Intentar parsear JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      // Log del error y del texto para depuración (solo en consola)
      console.error("Error al parsear JSON de Gemini. Texto recibido:", text);
      return res.status(502).json({
        error: "Gemini respondió en un formato no válido. Intenta nuevamente.",
      });
    }

    // Devolver la respuesta exitosa
    res.json(data);
  } catch (err) {
    // Capturar cualquier otro error (de red, SDK, etc.)
    console.error("Error en /api/optimize:", err);
    res.status(500).json({
      error: err?.message || "Error al consultar Gemini.",
    });
  }
});

// Catch-all para servir el frontend (SPA)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Iniciar servidor
app.listen(PORT, "0.0.0.0", () => console.log(`Prompt Optimizer AI: http://localhost:${PORT}`));