// Regenerates docs/AI-QUESTIONS.md from the prompt in packages/shared/src/ai-prompt.ts.
// Usage: npm run -w packages/shared build && node scripts/make-ai-prompt-doc.mjs
import fs from "node:fs";
import path from "node:path";
import { buildAiPrompt, DEFAULT_AI_PROMPT_OPTIONS } from "../packages/shared/dist/index.js";

const out = path.resolve(import.meta.dirname, "../docs/AI-QUESTIONS.md");
const doc = `# Questions from an AI chatbot

Claude, ChatGPT, Gemini and other chatbots can write a whole quiz for you in Kwistig's format.

## The easy way: in Kwistig

1. Go to **Admin** and click **✨ Quiz met AI**.
2. Fill in a topic, the language, the number of rounds and questions, the difficulty and which question types you want.
3. Click **Kopieer opdracht** and paste it into a new chat with the chatbot.
4. Copy the chatbot's whole reply, paste it into the box in Kwistig and click **Importeren**.
5. If Kwistig finds a problem, click **Kopieer herstelopdracht**, paste that into the same chat, and import the new reply.

The quiz opens in the editor. Read it through before the quiz night: chatbots make mistakes with facts, so check anything you're unsure about. You can add images, YouTube clips and Spotify fragments there too; the prompt leaves media out because chatbots invent links.

## Without Kwistig at hand

Copy the prompt below, change the lines under *The quiz* (topic, language, rounds, difficulty), and paste it into a chatbot. Save the JSON from the reply as a \`.json\` file and import it with **Admin → JSON importeren**.

This is the prompt with the default settings: general knowledge, Dutch, 3 rounds of 8 questions, all question types.

\`\`\`\`text
${buildAiPrompt(DEFAULT_AI_PROMPT_OPTIONS)}
\`\`\`\`
`;
fs.writeFileSync(out, doc, "utf8");
console.log(`wrote ${out}`);
