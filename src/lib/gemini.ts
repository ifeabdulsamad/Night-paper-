import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export interface StudyMaterial {
  summary: string;
  keyPoints: string[];
  flashcards: { question: string; answer: string; concept: string }[];
  questions: { question: string; options: string[]; answer: string; explanation: string }[];
}

export async function generateStudyMaterial(text: string): Promise<StudyMaterial> {
  const prompt = `Analyze the following text and generate study materials.
  Return a JSON object with:
  - summary: A clear, concise summary of the content.
  - keyPoints: A list of the most important insights and definitions.
  - flashcards: 5-8 flashcards with a 'concept', brief 'question', and 'answer'.
  - questions: 5-10 multiple-choice questions for practice with 'question', 'options' (array of 4), 'answer' (the correct option), and 'explanation'.

  TEXT:
  ${text.substring(0, 15000)} // Limiting to stay within token limits for a quick summary
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
          flashcards: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                answer: { type: Type.STRING },
                concept: { type: Type.STRING }
              },
              required: ["question", "answer", "concept"]
            }
          },
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                answer: { type: Type.STRING },
                explanation: { type: Type.STRING }
              },
              required: ["question", "options", "answer", "explanation"]
            }
          }
        },
        required: ["summary", "keyPoints", "flashcards", "questions"]
      }
    }
  });

  return JSON.parse(response.text || "{}") as StudyMaterial;
}
