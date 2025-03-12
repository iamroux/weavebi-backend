import { registerAs } from "@nestjs/config";

export default registerAs('llm', () => ({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    temperature: process.env.OPENAI_TEMPERATURE
}))