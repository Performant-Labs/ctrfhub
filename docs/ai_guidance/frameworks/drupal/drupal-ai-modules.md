# AI Modules in Drupal CMS 2.0

> **Installed version:** AI Core 1.3.2 (as of April 2026)
> **Local path:** `web/modules/contrib/ai/`
> **Official docs:** https://project.pages.drupalcode.org/ai/latest/
> **Project page:** https://www.drupal.org/project/ai

---

## Overview

Drupal CMS 2.0 ships with a full AI integration stack out of the box. The AI module
(`drupal/ai`) provides a **provider-agnostic abstraction layer** that lets you plug in
any LLM or AI service and use it uniformly across content workflows, search,
translation, field automation, and more.

The key design principle: your content and workflows are **not locked to a single
provider**. Swap OpenAI for Anthropic (or any of 48+ supported services) with a
configuration change, no code rewrite needed.

---

## Modules Included in This Site

### Core Package — `drupal/ai` v1.3.2

| Submodule | Machine Name | Status | Purpose |
|---|---|---|---|
| **AI Core** | `ai` | Stable | Provider abstraction layer; the foundation everything else builds on |
| **AI API Explorer** | `ai_api_explorer` | Stable | Admin UI to test prompts and explore model capabilities interactively |
| **AI Automators** | `ai_automators` | Stable | Automatically populate any Drupal field using AI on content create/edit |
| **AI Assistant API** | `ai_assistant_api` | Stable | Decoupled assistant framework; backend for chatbot UIs |
| **AI Chatbot** | `ai_chatbot` | Stable | Frontend chatbot UI wired to the Assistant API |
| **AI CKEditor** | `ai_ckeditor` | Stable | AI assistant inside CKEditor 5: prompt, rewrite, spelling, translate |
| **AI Content Suggestions** | `ai_content_suggestions` | Stable | Tone adjustment, summarization, taxonomy suggestions, moderation checks |
| **AI Translate** | `ai_translate` | Stable | One-click AI-powered translation for multilingual sites |
| **AI Validations** | `ai_validations` | Stable | LLM-powered field validation via the Field Validation module |
| **AI Logging** | `ai_logging` | Stable | Log every AI request and response with contextual metadata |
| **AI Observability** | `ai_observability` | Stable | Structured logging to Drupal Logger + OpenTelemetry |
| **AI Search** | `ai_search` | **Experimental** | Semantic/vector search via Search API + vector database backends |
| **Field Widget Actions** | `field_widget_actions` | Stable | Attach inline actions (e.g., AI generate) to field widgets in forms |

> **Deprecated submodules** (present in codebase, do not enable):
> - `ai_eca` — functionality merged into AI Core; being removed in AI 2.0.0
> - `ai_external_moderation` — functionality moved to AI Core

---

### Companion Modules (separately installed)

These are discrete `drupal/` packages that depend on AI Core:

| Module | Version | Purpose |
|---|---|---|
| **AI Agents** (`ai_agents`) | 1.2.3 | Agentic framework — give an AI agent the ability to take actions on your site (create content, run queries, etc.) |
| **AI Dashboard** (`ai_dashboard`) | 1.0.3 | Central admin dashboard showing AI module status, provider health, and usage |
| **AI Image Alt Text** (`ai_image_alt_text`) | 1.0.2 | Button in the image field widget to auto-generate alt text via AI |

---

### Provider Modules (also separately installed)

Providers are thin adapters that connect AI Core to external services. This site
ships with three:

| Module | Version | Service |
|---|---|---|
| **OpenAI Provider** (`ai_provider_openai`) | 1.2.1 | OpenAI — GPT-4o, GPT-4o-mini, DALL-E, Whisper, etc. |
| **Anthropic Provider** (`ai_provider_anthropic`) | 1.2.2 | Anthropic — Claude 3.5 Sonnet, Claude 3 Opus, etc. |
| **amazee.ai Provider** (`ai_provider_amazeeio`) | 1.2.7 | amazee.io managed AI gateway (useful for Lagoon-hosted sites) |

> **Other popular providers** not yet installed (from the 48+ available):
> AWS Bedrock, Azure OpenAI, Google Gemini, Google Vertex, Hugging Face, Ollama (local)

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Your Drupal Site                    │
│                                                      │
│  AI Automators · AI CKEditor · AI Chatbot           │
│  AI Search · AI Translate · AI Content Suggestions  │
│                      │                               │
│              ┌───────┴───────┐                       │
│              │   AI Core     │  ← abstraction layer  │
│              │   (ai.module) │                       │
│              └───────┬───────┘                       │
│                      │                               │
│     ┌────────────────┼────────────────┐              │
│     ▼                ▼                ▼              │
│  OpenAI          Anthropic        amazee.ai          │
│  Provider        Provider         Provider           │
└──────────────────────────────────────────────────────┘
```

AI Core defines **operation types** — standardized interfaces that all providers must implement:

| Operation Type | What It Does |
|---|---|
| `chat` | Conversational text generation (GPT-style) |
| `text_to_image` | Image generation (DALL-E, Stable Diffusion) |
| `image_to_text` | Image analysis / OCR / captioning |
| `text_to_speech` | TTS audio generation |
| `speech_to_text` | Transcription (Whisper etc.) |
| `text_to_embedding` | Generate vector embeddings for semantic search |
| `moderation` | Content moderation classification |

---

## Configuration

### 1. Install the Key module dependency
AI Core requires the **Key** module (`drupal/key`) to store API credentials securely.
Keys are stored in Drupal config (or offloaded to environment variables / vaults).

```
/admin/config/system/keys
```

### 2. Configure a Provider
After adding a Key, enable a provider and point it at your key:

```
/admin/config/ai/providers
```

### 3. Set Default Models Per Operation
Tell AI Core which provider/model to use for each operation type (chat, translate, etc.):

```
/admin/config/ai/settings
```

### 4. Explore in the API Explorer
Test your setup interactively before enabling it site-wide:

```
/admin/config/ai/explorer
```

### 5. AI Dashboard
Overall health view of your AI setup:

```
/admin/dashboard/ai
```

---

## Key Use Cases in Drupal CMS 2.0

### Field Automation (AI Automators)
Configure any field on any content type to be auto-populated by AI when editors save
content. Example: auto-generate meta descriptions, summarize body text into a teaser,
tag content with taxonomy terms. Chains of automators can create complex workflows.

### CKEditor AI Assistant
Editors get an inline AI button in the body editor. They can:
- Prompt AI for new content
- Rewrite / expand / shorten selected text
- Translate selections
- Fix spelling and grammar

### Semantic Search (Experimental)
Integrate AI embeddings with Drupal's Search API to enable:
- **Semantic search** — search by meaning, not just keywords
- **RAG (Retrieval Augmented Generation)** — ground chatbot answers in your actual content to reduce hallucinations

Requires a vector database provider (Milvus, Pinecone, Postgres, SQLite, Azure AI Search).

### AI Agents
The Agents module (`ai_agents`) lets an AI take actions on your site autonomously.
An agent can be given tools (create node, query views, look up users) and orchestrate
them to complete multi-step tasks in response to a natural language instruction.

---

## Developer Integration

### Minimal Chat Call

```php
$sets = \Drupal::service('ai.provider')
  ->getDefaultProviderForOperationType('chat');

$provider = \Drupal::service('ai.provider')
  ->createInstance($sets['provider_id']);

$messages = new ChatInput([
  new ChatMessage('system', 'You are a helpful Drupal assistant.'),
  new ChatMessage('user', $input),
]);

$response = $provider->chat($messages, $sets['model_id'])->getNormalized();
return $response->getText();
```

### Image Generation Call

```php
$provider->setConfiguration([
  'n' => 1,
  'response_format' => 'url',
  'size' => '1024x1024',
  'quality' => 'standard',
  'style' => 'vivid',
]);

$input = new TextToImageInput($prompt);
$response = $provider->textToImage($input, $default_model, ['tag_1']);
$url = $this->saveAndGetImageUrl($response);
```

---

## Notable Ecosystem Modules (Not Yet Installed)

| Module | Purpose |
|---|---|
| `ai_seo` | SEO analysis inline in the node view |
| `ai_image` | AI image generation in CKEditor (DALL-E, Stable Diffusion) |
| `ai_media_image` | AI image generation directly into the media library |
| `ai_migrate` | AI-assisted Drupal migrations |
| `ai_summarize_document` | Summarize PDFs in CKEditor |
| `ai_search_block` | Drop-in RAG search block |
| `ai_related_content` | AI-powered content recommendations |
| `ai_webform_guard` | AI spam protection for webforms |
| `ai_tmgmt` | TMGMT translation provider backed by AI |
| `llmstxt` | Exposes site content to LLMs at inference time |
| `ai_usage_limits` | Rate-limiting / budget controls for AI usage |
| `auto_translation` | Automatic translations workflow |

---

## Best Practices

When building AI integrations within the Drupal CMS 2.0 ecosystem, adhere to these established community guidelines:

1. **Strict Service Abstraction (Provider Independence)**
   Never build against a specific provider's API directly (e.g., executing raw cURL requests to OpenAI). Always pass operations through the AI Core Abstraction framework. Using `\Drupal::service('ai.provider')->getDefaultProviderForOperationType('chat')` ensures your underlying codebase survives completely intact even if you swap LLM providers at the infrastructure level.

2. **Never Store Keys in Config or Code**
   Always utilize the **Key module** (`drupal/key`). All credentials and tokens must be offloaded to secure environment variables or vaults. The AI Provider adapters explicitly integrate with Key module tokens. Do not bypass this by hardcoding or placing API secrets into default PHP config structures.

3. **Let the Engine Pre-Populate Content (AI Automators)**
   Instead of creating heavy custom controllers to intercept form submissions for AI tasks, rely on **AI Automators**. Automators tie gracefully into native Drupal form lifecycles (e.g., triggering on node save), abstracting away custom hooks to seamlessly auto-generate taxonomy tags, meta descriptions, or translations.

4. **Test Safely via API Explorer**
   Utilize the native **AI API Explorer** (`/admin/config/ai/explorer`) to interactively test your LLM prompt formulations and boundaries within the Drupal backend *before* rigorously committing the prompt structures back into your codebase.

---

## Resources

- **Module docs:** https://project.pages.drupalcode.org/ai/latest/
- **Installation guide:** https://project.pages.drupalcode.org/ai/1.2.x/
- **Developer API:** https://project.pages.drupalcode.org/ai/1.2.x/developers/developer_information/
- **Drupal.org project:** https://www.drupal.org/project/ai
- **Slack channel:** `#ai` at drupal.slack.com
- **Issue queue:** https://www.drupal.org/project/issues/ai
- **Source:** https://git.drupalcode.org/project/ai
- **Providers list:** https://new.drupal.org/ai/about-drupal-ai/providers
