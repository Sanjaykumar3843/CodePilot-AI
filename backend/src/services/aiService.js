const { Groq } = require('groq-sdk');
const { groqApiKey, groqModel } = require('../config');
const fileSystemService = require('./fileSystemService');

/**
 * Validates prompt input length and type.
 */
function validatePrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    const error = new Error('A development prompt or instruction is required.');
    error.status = 400;
    throw error;
  }

  const trimmed = prompt.trim();
  if (trimmed.length > 4000) {
    const error = new Error('Prompt exceeds maximum allowed length of 4000 characters.');
    error.status = 400;
    throw error;
  }

  return trimmed;
}

/**
 * Creates Groq client instance if API key is present.
 */
function getGroqClient() {
  if (!groqApiKey) {
    const error = new Error(
      'GROQ_API_KEY is not configured on the backend. Please provide a valid Groq API key in backend/.env to enable AI generation.'
    );
    error.status = 503;
    error.code = 'AI_KEY_MISSING';
    throw error;
  }

  return new Groq({ apiKey: groqApiKey });
}

/**
 * System prompt instructing model to output strictly valid JSON describing code modifications.
 */
const SYSTEM_PROMPT = `You are CodePilot AI, a Senior Full-Stack Engineer and Frontend Specialist.
The user will provide a frontend development task or instruction.
You may also be provided with relevant existing project file paths or contents.

Your role:
1. Analyze the request carefully.
2. Determine which files should be created or updated.
3. Provide full, high-quality, production-ready replacement content for each file.
4. Output STRICTLY a valid, parseable JSON object with no markdown fences, no backticks, and no commentary.
5. All source code in "content" must be valid JSON strings with properly escaped newlines (\\n) and quotes (\\").

The JSON output MUST match this exact schema:
{
  "explanation": "Clear explanation of the architectural approach, changes made, and reasoning.",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "action": "create",
      "content": "Full source code for the file"
    }
  ]
}`;

/**
 * Extracts failed_generation from Groq API error response if json_validate_failed occurred.
 */
function extractFailedGeneration(err) {
  if (!err) return null;

  // Case 1: direct property on error object
  if (err.error?.failed_generation) {
    return err.error.failed_generation;
  }
  if (err.failed_generation) {
    return err.failed_generation;
  }

  // Case 2: parse from error message string
  const msg = err.message;
  if (typeof msg === 'string') {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.error?.failed_generation) return parsed.error.failed_generation;
      if (parsed.failed_generation) return parsed.failed_generation;
    } catch {}

    const jsonMatch = msg.match(/"failed_generation"\s*:\s*("(?:[^"\\]|\\.)*")/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {}
    }
  }

  return null;
}

/**
 * Executes chat completion with Groq, with safe retry for transient network/rate errors
 * and recovery from provider-side json_validate_failed issues.
 */
async function executeGroqWithRetry(client, messages, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: groqModel,
        messages,
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });

      return response;
    } catch (err) {
      // Recovery 1: Check if Groq sent the generated JSON inside failed_generation
      const failedGen = extractFailedGeneration(err);
      if (failedGen) {
        return {
          choices: [{ message: { content: failedGen } }],
        };
      }

      // Recovery 2: If json_validate_failed happened, retry once in text mode without strict validator
      const isJsonValidateFail =
        err.status === 400 &&
        (err.code === 'json_validate_failed' ||
          (typeof err.message === 'string' && err.message.includes('json_validate_failed')));

      if (isJsonValidateFail) {
        try {
          const fallbackRes = await client.chat.completions.create({
            model: groqModel,
            messages,
            temperature: 0.2,
            max_tokens: 4096,
          });
          return fallbackRes;
        } catch (fallbackErr) {
          // If fallback fails, continue to transient check or throw
          const recovered = extractFailedGeneration(fallbackErr);
          if (recovered) {
            return { choices: [{ message: { content: recovered } }] };
          }
        }
      }

      // Transient network / rate limit retry
      const isTransient = err.status === 429 || err.status === 500 || err.status === 503;
      if (isTransient && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }

      throw err;
    }
  }
}

/**
 * Generates proposed code changes for a given prompt and optional context files.
 */
async function generatePlan({ prompt, contextFiles = [] }) {
  const cleanPrompt = validatePrompt(prompt);
  const client = getGroqClient();

  // Gather context from files if provided
  const contextSnippets = [];
  if (Array.isArray(contextFiles)) {
    for (const relPath of contextFiles.slice(0, 5)) { // Limit to 5 context files
      try {
        if (typeof relPath === 'string' && fileSystemService.isPathSafe(relPath)) {
          const fileData = fileSystemService.readFile(relPath);
          contextSnippets.push(`File: ${fileData.path}\n\`\`\`\n${fileData.content.slice(0, 5000)}\n\`\`\``);
        }
      } catch (err) {
        // Skip unreadable files
      }
    }
  }

  const userContent = contextSnippets.length > 0
    ? `Task:\n${cleanPrompt}\n\nProject Context:\n${contextSnippets.join('\n\n')}`
    : `Task:\n${cleanPrompt}`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  let rawResponseText = '';
  try {
    const completion = await executeGroqWithRetry(client, messages, 1);
    rawResponseText = completion.choices?.[0]?.message?.content || '';
  } catch (err) {
    if (err.status === 401) {
      const error = new Error('Groq API authentication failed. Verify GROQ_API_KEY.');
      error.status = 502;
      throw error;
    }
    const error = new Error(err.message || 'AI provider request failed.');
    error.status = err.status || 502;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawResponseText.trim());
  } catch (err) {
    // Attempt fallback json extraction if response had surrounding text or markdown fences
    const jsonMatch = rawResponseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (subErr) {
        const error = new Error('Failed to parse AI response into structured JSON format.');
        error.status = 502;
        throw error;
      }
    } else {
      const error = new Error('AI response was not in expected structured format.');
      error.status = 502;
      throw error;
    }
  }

  const explanation = typeof parsed.explanation === 'string' ? parsed.explanation : 'Proposed changes generated.';
  const proposedFiles = [];

  if (Array.isArray(parsed.files)) {
    for (const item of parsed.files) {
      if (item && typeof item.path === 'string' && typeof item.content === 'string') {
        const normalizedRel = item.path.trim().replace(/^[/\\]+/, '');
        if (fileSystemService.isPathSafe(normalizedRel)) {
          // Generate unified diff
          const diffResult = fileSystemService.createUnifiedDiff(normalizedRel, item.content);
          proposedFiles.push({
            path: normalizedRel,
            action: item.action === 'create' ? 'create' : 'modify',
            isNew: diffResult.isNew,
            patch: diffResult.patch,
            proposedContent: item.content,
            originalHash: diffResult.originalHash,
            proposedHash: diffResult.proposedHash,
          });
        }
      }
    }
  }

  return {
    success: true,
    explanation,
    model: groqModel,
    files: proposedFiles,
  };
}

module.exports = {
  validatePrompt,
  getGroqClient,
  generatePlan,
};
