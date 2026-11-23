import type { Language, Quiz } from "./quiz.js";

/**
 * A prompt for Claude, ChatGPT or another chatbot that makes it write a quiz in
 * Kwistig's JSON format, ready for "JSON importeren". Media is left out on
 * purpose: chatbots can't supply images and tend to invent YouTube/Spotify links.
 */

export const AI_ANSWER_TYPES = ["multiple_choice", "true_false", "open", "number", "buzzer"] as const;
export type AiAnswerType = (typeof AI_ANSWER_TYPES)[number];

export interface AiPromptOptions {
  topic: string;
  language: Language;
  /** Also write every text in the other language ({ "nl": …, "en": … }). */
  bilingual: boolean;
  rounds: number;
  questionsPerRound: number;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  types: AiAnswerType[];
  /** Optional: who's playing, e.g. "family with teenagers". */
  audience?: string;
}

export const DEFAULT_AI_PROMPT_OPTIONS: AiPromptOptions = {
  topic: "general knowledge",
  language: "nl",
  bilingual: false,
  rounds: 3,
  questionsPerRound: 8,
  difficulty: "mixed",
  types: ["multiple_choice", "true_false", "open", "number", "buzzer"],
};

/** A small but complete example in the format; the tests check it against the schema. */
export function aiExampleQuiz(language: Language, bilingual: boolean): Quiz {
  const nl = language === "nl";
  const tx = (nlText: string, enText: string) => (bilingual ? { nl: nlText, en: enText } : nl ? nlText : enText);
  return {
    version: 1,
    title: tx("Voorbeeldquiz", "Example quiz"),
    language,
    description: tx("Korte omschrijving van de quiz.", "A short description of the quiz."),
    rounds: [
      {
        title: tx("Ronde 1: Aardrijkskunde", "Round 1: Geography"),
        defaults: { points: 1, timeLimitSec: 30 },
        items: [
          { kind: "slide", title: tx("Ronde 1: Aardrijkskunde", "Round 1: Geography"), body: tx("Pak je telefoon erbij!", "Grab your phone!") },
          {
            kind: "question",
            answerType: "multiple_choice",
            prompt: tx("Wat is de hoofdstad van Australië?", "What is the capital of Australia?"),
            options: ["Sydney", "Melbourne", "Canberra", "Perth"],
            correct: 2,
            explanation: tx("Canberra werd in 1913 gekozen als compromis.", "Canberra was chosen in 1913 as a compromise."),
            hostNotes: nl ? "Veel mensen zeggen Sydney." : "Many people say Sydney.",
          },
          { kind: "question", answerType: "true_false", prompt: tx("Een octopus heeft drie harten.", "An octopus has three hearts."), correct: true },
          {
            kind: "question",
            answerType: "open",
            prompt: tx("Welke rivier stroomt door Parijs?", "Which river flows through Paris?"),
            acceptedAnswers: ["Seine", "De Seine", "La Seine"],
          },
          {
            kind: "question",
            answerType: "number",
            prompt: tx("In welk jaar viel de Berlijnse Muur?", "In which year did the Berlin Wall fall?"),
            correct: 1989,
            scoring: { mode: "tolerance", tolerance: 1 },
          },
          {
            kind: "question",
            answerType: "number",
            prompt: tx("Hoe hoog is de Eiffeltoren?", "How tall is the Eiffel Tower?"),
            correct: 330,
            unit: tx("meter", "metres"),
            scoring: { mode: "closest" },
            points: 2,
          },
          {
            kind: "question",
            answerType: "buzzer",
            prompt: tx("Noem de langste rivier van Europa.", "Name the longest river in Europe."),
            answer: tx("De Wolga", "The Volga"),
            points: 2,
          },
          { kind: "slide", title: tx("Tussenstand", "Standings"), show: "scoreboard" },
        ],
      },
    ],
  };
}

const TYPE_RULES: Record<AiAnswerType, string> = {
  multiple_choice:
    '- "multiple_choice": "options" has 2 to 6 answers (4 is best) and "correct" is the 0-based index of the right one. Put the right answer in a different position each time. Wrong options must be plausible.',
  true_false: '- "true_false": a statement; "correct" is true or false. Mix true and false statements.',
  open:
    '- "open": teams type a short answer. "acceptedAnswers" lists the right answer first, then common spellings and variants (with and without articles, abbreviations, last name only). Small typos are accepted automatically, so don\'t list misspellings. The answer must be one or a few words, never a sentence.',
  number:
    '- "number": "correct" is a number (no thousands separators or units in it). Add "unit" when it helps (e.g. "meter"). "scoring" is { "mode": "closest" } (the closest team wins) or { "mode": "tolerance", "tolerance": N } (everyone within ±N is right). Use tolerance for years and exact facts, closest for estimates.',
  buzzer:
    '- "buzzer": the first team to press says the answer out loud and the quizmaster judges it. "answer" is the right answer as text. Good for quick questions with a short, clear answer. Give it 2 or 3 points.',
};

export function buildAiPrompt(o: AiPromptOptions): string {
  const langName = o.language === "nl" ? "Dutch" : "English";
  const other = o.language === "nl" ? "English" : "Dutch";
  const types = o.types.length ? o.types : [...AI_ANSWER_TYPES];
  const difficulty =
    o.difficulty === "mixed" ? "a mix of easy, medium and a few hard questions" : `${o.difficulty} questions`;
  const example = JSON.stringify(aiExampleQuiz(o.language, o.bilingual), null, 2);

  return `You are writing a pub quiz for Kwistig, a living-room quiz app. Your answer must be a single JSON document that Kwistig can import.

## The quiz

- Topic: ${o.topic.trim() || "general knowledge"}
- Language: ${langName}${o.bilingual ? ` (with an ${other} translation of every text, see below)` : ""}
${o.audience?.trim() ? `- Players: ${o.audience.trim()}\n` : ""}- ${o.rounds} round${o.rounds === 1 ? "" : "s"} of ${o.questionsPerRound} questions each, every round with its own theme within the topic
- Difficulty: ${difficulty}
- Question types to use: ${types.map((t) => `"${t}"`).join(", ")}. Mix them within each round.

## Quality

- Check every fact. Only ask questions with one undisputed answer; skip anything that changes over time (records, "current" office holders) unless the question names the year.
- Write questions that are fun to answer in a group, read aloud well, and fit on a TV screen: at most about 120 characters.
- Add a short "explanation" with a fun fact to some questions; it is shown on the TV with the answer.
- "hostNotes" is optional plain text that only the quizmaster sees (pronunciation, sources, likely wrong answers).

## The format

- "version" is always 1. "language" is "${o.language}".
- Every text is ${
    o.bilingual
      ? `an object with both languages: { "nl": "…", "en": "…" }. Option texts may stay plain strings when they are the same in both languages (names, numbers).`
      : `a plain string in ${langName}.`
  }
- The quiz has "rounds"; each round has a "title", optional "defaults" ({ "points": 1, "timeLimitSec": 30 }) and "items".
- Start each round with a slide: { "kind": "slide", "title": …, "body": … } ("body" is optional, **bold** works). End the quiz with { "kind": "slide", "title": …, "show": "scoreboard" }; you can also put one between rounds.
- Questions are { "kind": "question", "answerType": …, "prompt": … } plus the fields for their type:
${types.map((t) => TYPE_RULES[t]).join("\n")}
- Optional on every question: "points" (a positive number, default 1), "timeLimitSec" (a whole number from 5 to 600), "explanation", "hostNotes".
- Do not add images, videos, music or any field that is not shown here. Kwistig rejects unknown fields.

## Example

This example shows every field and question type; follow its structure exactly, but write your own content:

\`\`\`json
${example}
\`\`\`

## Output

Reply with only the complete JSON in one \`\`\`json code block, no text before or after it. Make sure it is valid JSON: double quotes, no trailing commas, no comments.`;
}

/** A follow-up prompt when Kwistig rejected the AI's JSON. */
export function buildAiFixPrompt(issues: { path: string; message: string }[], invalidJson = false): string {
  if (invalidJson) {
    return "Kwistig could not read your answer as JSON. Please send the complete quiz again as valid JSON in one ```json code block: double quotes, no trailing commas, no comments, nothing before or after the block.";
  }
  const list = issues
    .slice(0, 30)
    .map((i) => `- ${i.path || "(root)"}: ${i.message}`)
    .join("\n");
  return `Kwistig rejected the quiz JSON with these problems (paths like rounds[0].items[3].correct count from 0):

${list}

Please fix them and send the complete corrected quiz again, in one \`\`\`json code block with nothing before or after it.`;
}

/**
 * Pulls the JSON out of a chatbot reply: the first ```json block if there is one,
 * otherwise everything from the first "{" to the last "}".
 */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SyntaxError("no JSON object found");
  return JSON.parse(body.slice(start, end + 1));
}
