import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Quiz } from "@kwistig/shared";

export async function schemaRoutes(app: FastifyInstance) {
  const jsonSchema = {
    ...z.toJSONSchema(Quiz, { target: "draft-2020-12", io: "input" }),
    $id: "kwistig-quiz.schema.json",
    title: "Kwistig quiz",
  };
  app.get("/quiz.json", async () => jsonSchema);
}
