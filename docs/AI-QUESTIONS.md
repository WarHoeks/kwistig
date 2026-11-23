# Questions from an AI chatbot

Claude, ChatGPT, Gemini and other chatbots can write a whole quiz for you in Kwistig's format.

## The easy way: in Kwistig

1. Go to **Admin** and click **✨ Quiz met AI**.
2. Fill in a topic, the language, the number of rounds and questions, the difficulty and which question types you want.
3. Click **Kopieer opdracht** and paste it into a new chat with the chatbot.
4. Copy the chatbot's whole reply, paste it into the box in Kwistig and click **Importeren**.
5. If Kwistig finds a problem, click **Kopieer herstelopdracht**, paste that into the same chat, and import the new reply.

The quiz opens in the editor. Read it through before the quiz night: chatbots make mistakes with facts, so check anything you're unsure about. You can add images, YouTube clips and Spotify fragments there too; the prompt leaves media out because chatbots invent links.

## Without Kwistig at hand

Copy the prompt below, change the lines under *The quiz* (topic, language, rounds, difficulty), and paste it into a chatbot. Save the JSON from the reply as a `.json` file and import it with **Admin → JSON importeren**.

This is the prompt with the default settings: general knowledge, Dutch, 3 rounds of 8 questions, all question types.

````text
You are writing a pub quiz for Kwistig, a living-room quiz app. Your answer must be a single JSON document that Kwistig can import.

## The quiz

- Topic: general knowledge
- Language: Dutch
- 3 rounds of 8 questions each, every round with its own theme within the topic
- Difficulty: a mix of easy, medium and a few hard questions
- Question types to use: "multiple_choice", "true_false", "open", "number", "buzzer". Mix them within each round.

## Quality

- Check every fact. Only ask questions with one undisputed answer; skip anything that changes over time (records, "current" office holders) unless the question names the year.
- Write questions that are fun to answer in a group, read aloud well, and fit on a TV screen: at most about 120 characters.
- Add a short "explanation" with a fun fact to some questions; it is shown on the TV with the answer.
- "hostNotes" is optional plain text that only the quizmaster sees (pronunciation, sources, likely wrong answers).

## The format

- "version" is always 1. "language" is "nl".
- Every text is a plain string in Dutch.
- The quiz has "rounds"; each round has a "title", optional "defaults" ({ "points": 1, "timeLimitSec": 30 }) and "items".
- Start each round with a slide: { "kind": "slide", "title": …, "body": … } ("body" is optional, **bold** works). End the quiz with { "kind": "slide", "title": …, "show": "scoreboard" }; you can also put one between rounds.
- Questions are { "kind": "question", "answerType": …, "prompt": … } plus the fields for their type:
- "multiple_choice": "options" has 2 to 6 answers (4 is best) and "correct" is the 0-based index of the right one. Put the right answer in a different position each time. Wrong options must be plausible.
- "true_false": a statement; "correct" is true or false. Mix true and false statements.
- "open": teams type a short answer. "acceptedAnswers" lists the right answer first, then common spellings and variants (with and without articles, abbreviations, last name only). Small typos are accepted automatically, so don't list misspellings. The answer must be one or a few words, never a sentence.
- "number": "correct" is a number (no thousands separators or units in it). Add "unit" when it helps (e.g. "meter"). "scoring" is { "mode": "closest" } (the closest team wins) or { "mode": "tolerance", "tolerance": N } (everyone within ±N is right). Use tolerance for years and exact facts, closest for estimates.
- "buzzer": the first team to press says the answer out loud and the quizmaster judges it. "answer" is the right answer as text. Good for quick questions with a short, clear answer. Give it 2 or 3 points.
- Optional on every question: "points" (a positive number, default 1), "timeLimitSec" (a whole number from 5 to 600), "explanation", "hostNotes".
- Do not add images, videos, music or any field that is not shown here. Kwistig rejects unknown fields.

## Example

This example shows every field and question type; follow its structure exactly, but write your own content:

```json
{
  "version": 1,
  "title": "Voorbeeldquiz",
  "language": "nl",
  "description": "Korte omschrijving van de quiz.",
  "rounds": [
    {
      "title": "Ronde 1: Aardrijkskunde",
      "defaults": {
        "points": 1,
        "timeLimitSec": 30
      },
      "items": [
        {
          "kind": "slide",
          "title": "Ronde 1: Aardrijkskunde",
          "body": "Pak je telefoon erbij!"
        },
        {
          "kind": "question",
          "answerType": "multiple_choice",
          "prompt": "Wat is de hoofdstad van Australië?",
          "options": [
            "Sydney",
            "Melbourne",
            "Canberra",
            "Perth"
          ],
          "correct": 2,
          "explanation": "Canberra werd in 1913 gekozen als compromis.",
          "hostNotes": "Veel mensen zeggen Sydney."
        },
        {
          "kind": "question",
          "answerType": "true_false",
          "prompt": "Een octopus heeft drie harten.",
          "correct": true
        },
        {
          "kind": "question",
          "answerType": "open",
          "prompt": "Welke rivier stroomt door Parijs?",
          "acceptedAnswers": [
            "Seine",
            "De Seine",
            "La Seine"
          ]
        },
        {
          "kind": "question",
          "answerType": "number",
          "prompt": "In welk jaar viel de Berlijnse Muur?",
          "correct": 1989,
          "scoring": {
            "mode": "tolerance",
            "tolerance": 1
          }
        },
        {
          "kind": "question",
          "answerType": "number",
          "prompt": "Hoe hoog is de Eiffeltoren?",
          "correct": 330,
          "unit": "meter",
          "scoring": {
            "mode": "closest"
          },
          "points": 2
        },
        {
          "kind": "question",
          "answerType": "buzzer",
          "prompt": "Noem de langste rivier van Europa.",
          "answer": "De Wolga",
          "points": 2
        },
        {
          "kind": "slide",
          "title": "Tussenstand",
          "show": "scoreboard"
        }
      ]
    }
  ]
}
```

## Output

Reply with only the complete JSON in one ```json code block, no text before or after it. Make sure it is valid JSON: double quotes, no trailing commas, no comments.
````
